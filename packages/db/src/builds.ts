import { ValidationError } from '@circi/core'
import { and, desc, eq, inArray, ne, sql } from 'drizzle-orm'

import type { Database } from './client.ts'
import { ConflictError, isUniqueViolation, NotFoundError } from './errors.ts'
import { enqueueJob, QUEUES } from './jobs.ts'
import {
  buildShards,
  builds,
  files,
  projects,
  reviews,
  screenshotDiffs,
  screenshots,
  uploadClaims,
} from './schema.ts'

export type Build = typeof builds.$inferSelect
export type Screenshot = typeof screenshots.$inferSelect
export type ScreenshotDiff = typeof screenshotDiffs.$inferSelect
export type ProjectRow = typeof projects.$inferSelect

const SHA_RE = /^[0-9a-f]{7,64}$/
const BUILD_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/
const MAX_ANCESTORS = 2_000

export async function findProjectByTokenHash(
  db: Database,
  tokenHash: string,
): Promise<ProjectRow | undefined> {
  const [row] = await db.select().from(projects).where(eq(projects.tokenHash, tokenHash))
  return row
}

export interface CreateBuildInput {
  projectId: string
  name?: string
  commitSha: string
  branch?: string | null
  prNumber?: number | null
  baseBranch?: string | null
  mergeBaseSha?: string | null
  ancestorShas?: string[]
  ancestryStatus?: 'ok' | 'missing' | 'truncated'
  parallel?: { nonce: string; total: number }
}

/**
 * Creates a build, or joins the existing one for parallel shards (PLAN §7.1 step 4): shards
 * that start at the same moment hit the unique (project, name, commit, nonce) index and all
 * get the same build.
 */
export async function createBuild(db: Database, input: CreateBuildInput): Promise<Build> {
  const name = input.name ?? 'default'
  if (!BUILD_NAME_RE.test(name)) {
    throw new ValidationError(
      `Invalid build name "${name}": use letters, digits, ".", "_" or "-" (max 64)`,
    )
  }
  const commitSha = input.commitSha.toLowerCase()
  if (!SHA_RE.test(commitSha)) throw new ValidationError(`Invalid commit SHA "${input.commitSha}"`)
  const ancestorShas = (input.ancestorShas ?? []).map((s) => s.toLowerCase())
  if (ancestorShas.length > MAX_ANCESTORS || ancestorShas.some((s) => !SHA_RE.test(s))) {
    throw new ValidationError(`ancestorShas must be at most ${MAX_ANCESTORS} commit SHAs`)
  }
  if (input.parallel && (input.parallel.total < 1 || input.parallel.total > 1_000)) {
    throw new ValidationError('parallel.total must be between 1 and 1000')
  }

  const values = {
    projectId: input.projectId,
    name,
    commitSha,
    branch: input.branch ?? null,
    prNumber: input.prNumber ?? null,
    baseBranch: input.baseBranch ?? null,
    mergeBaseSha: input.mergeBaseSha?.toLowerCase() ?? null,
    ancestorShas,
    ancestryStatus: input.ancestryStatus ?? (ancestorShas.length > 0 ? 'ok' : 'missing'),
    status: 'uploading' as const,
    parallelNonce: input.parallel?.nonce ?? null,
    parallelTotal: input.parallel?.total ?? null,
  }

  return db.transaction(async (tx) => {
    if (input.parallel) {
      const existing = await findParallelBuild(
        tx,
        input.projectId,
        name,
        commitSha,
        input.parallel.nonce,
      )
      if (existing) return existing
    }
    const [counter] = await tx
      .update(projects)
      .set({ buildCounter: sql`${projects.buildCounter} + 1` })
      .where(eq(projects.id, input.projectId))
      .returning({ number: projects.buildCounter })
    if (!counter) throw new NotFoundError('project not found')

    const [created] = await tx
      .insert(builds)
      .values({ ...values, number: counter.number })
      .onConflictDoNothing({
        target: [builds.projectId, builds.name, builds.commitSha, builds.parallelNonce],
        where: sql`${builds.parallelNonce} is not null`,
      })
      .returning()
    if (created) return created
    // Lost the race to a concurrent shard: join its build. (The bumped number stays unused.)
    const joined =
      input.parallel &&
      (await findParallelBuild(tx, input.projectId, name, commitSha, input.parallel.nonce))
    if (!joined) throw new Error('parallel build vanished after conflict')
    return joined
  })
}

async function findParallelBuild(
  db: Database,
  projectId: string,
  name: string,
  commitSha: string,
  nonce: string,
): Promise<Build | undefined> {
  const [row] = await db
    .select()
    .from(builds)
    .where(
      and(
        eq(builds.projectId, projectId),
        eq(builds.name, name),
        eq(builds.commitSha, commitSha),
        eq(builds.parallelNonce, nonce),
      ),
    )
  return row
}

export async function getProjectBuild(
  db: Database,
  projectId: string,
  buildId: string,
): Promise<Build | undefined> {
  const [row] = await db
    .select()
    .from(builds)
    .where(and(eq(builds.id, buildId), eq(builds.projectId, projectId)))
  return row
}

export interface FinalizeScreenshot {
  name: string
  sha256: string
  metadata?: Record<string, unknown>
}

export type FinalizeResult =
  | { status: 'ok'; complete: boolean; shardsReceived: number; shardsTotal: number }
  /** Some files aren't verified yet: the client must (re)upload them. */
  | { status: 'missing'; missing: string[] }

const SCREENSHOT_NAME_RE = /^[^\0\n\r]{1,512}$/

/**
 * Records one shard's screenshots (PLAN §7.1 step 6). A retried shard replaces its own
 * screenshots instead of being counted twice. When every shard is in, the build moves to
 * `processing` and the processing job is enqueued in the same transaction.
 */
export async function finalizeBuild(
  db: Database,
  input: { buildId: string; shardIndex?: string; screenshots: FinalizeScreenshot[] },
): Promise<FinalizeResult> {
  const shardIndex = input.shardIndex ?? '0'
  const names = new Set<string>()
  for (const s of input.screenshots) {
    if (!SCREENSHOT_NAME_RE.test(s.name))
      throw new ValidationError(`Invalid screenshot name "${s.name}"`)
    if (names.has(s.name)) throw new ValidationError(`Duplicate screenshot name "${s.name}"`)
    names.add(s.name)
  }
  const shas = [...new Set(input.screenshots.map((s) => s.sha256))]

  return db.transaction(async (tx) => {
    const [build] = await tx.select().from(builds).where(eq(builds.id, input.buildId)).for('update')
    if (!build) throw new NotFoundError('build not found')
    if (build.status !== 'uploading' && build.status !== 'pending') {
      throw new ConflictError(
        `Build #${build.number} is already ${build.status}; it can't take more screenshots`,
      )
    }

    if (shas.length > 0) {
      const verified = await tx
        .select({ sha256: files.sha256 })
        .from(files)
        .where(and(inArray(files.sha256, shas), eq(files.status, 'verified')))
      const ok = new Set(verified.map((r) => r.sha256))
      const missing = shas.filter((s) => !ok.has(s))
      if (missing.length > 0) return { status: 'missing', missing }
    }

    await tx
      .delete(screenshots)
      .where(and(eq(screenshots.buildId, build.id), eq(screenshots.shardIndex, shardIndex)))
    if (input.screenshots.length > 0) {
      try {
        await tx.insert(screenshots).values(
          input.screenshots.map((s) => ({
            buildId: build.id,
            shardIndex,
            name: s.name,
            fileSha256: s.sha256,
            metadata: s.metadata ?? {},
          })),
        )
      } catch (err) {
        if (isUniqueViolation(err)) {
          throw new ConflictError(
            'Another shard of this build already uploaded a screenshot with one of these names',
          )
        }
        throw err
      }
    }
    // Screenshots now reference these files, so the claims that protected them can go.
    if (shas.length > 0) {
      await tx
        .delete(uploadClaims)
        .where(and(eq(uploadClaims.buildId, build.id), inArray(uploadClaims.fileSha256, shas)))
    }

    await tx
      .insert(buildShards)
      .values({ buildId: build.id, shardIndex })
      .onConflictDoUpdate({
        target: [buildShards.buildId, buildShards.shardIndex],
        set: { finalizedAt: new Date() },
      })
    const [{ count } = { count: 0 }] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(buildShards)
      .where(eq(buildShards.buildId, build.id))
    const total = build.parallelTotal ?? 1
    const complete = count >= total

    if (complete) {
      await tx
        .update(builds)
        .set({ status: 'processing', finalizedAt: new Date() })
        .where(eq(builds.id, build.id))
      await tx.delete(uploadClaims).where(eq(uploadClaims.buildId, build.id))
      await enqueueJob(tx, {
        queue: QUEUES.processBuild,
        payload: { buildId: build.id },
        dedupeKey: build.id,
      })
    } else if (build.status === 'pending') {
      await tx.update(builds).set({ status: 'uploading' }).where(eq(builds.id, build.id))
    }
    return { status: 'ok', complete, shardsReceived: count, shardsTotal: total }
  })
}

export interface BuildCounts {
  added: number
  removed: number
  changed: number
  unchanged: number
  failed: number
  total: number
}

export async function getBuildCounts(db: Database, buildId: string): Promise<BuildCounts> {
  const rows = await db
    .select({ status: screenshotDiffs.status, n: sql<number>`count(*)::int` })
    .from(screenshotDiffs)
    .where(eq(screenshotDiffs.buildId, buildId))
    .groupBy(screenshotDiffs.status)
  const counts: BuildCounts = {
    added: 0,
    removed: 0,
    changed: 0,
    unchanged: 0,
    failed: 0,
    total: 0,
  }
  for (const r of rows) {
    if (r.status && r.status in counts) counts[r.status] += r.n
    counts.total += r.n
  }
  return counts
}

// ---------------------------------------------------------------------------------------------
// Worker side (PLAN §7.2, §7.3)
// ---------------------------------------------------------------------------------------------

/** Possible baselines: same project and name, finished, not the build itself. */
export async function listBaselineCandidates(db: Database, build: Build): Promise<Build[]> {
  const conditions = [
    eq(builds.projectId, build.projectId),
    eq(builds.name, build.name),
    eq(builds.status, 'complete'),
    ne(builds.id, build.id),
  ]
  const shas = [...new Set(build.ancestorShas)]
  const project = await db
    .select({ defaultBranch: projects.defaultBranch })
    .from(projects)
    .where(eq(projects.id, build.projectId))
  const defaultBranch = project[0]?.defaultBranch ?? 'main'

  // Builds on ancestor commits, plus recent default-branch builds for the fallback.
  const byAncestry =
    shas.length > 0
      ? await db
          .select()
          .from(builds)
          .where(and(...conditions, inArray(builds.commitSha, shas)))
      : []
  const recentDefault = await db
    .select()
    .from(builds)
    .where(and(...conditions, eq(builds.branch, defaultBranch)))
    .orderBy(desc(builds.createdAt))
    .limit(50)
  const seen = new Map<string, Build>()
  for (const b of [...byAncestry, ...recentDefault]) seen.set(b.id, b)
  return [...seen.values()]
}

export async function listBuildScreenshots(db: Database, buildId: string): Promise<Screenshot[]> {
  return db.select().from(screenshots).where(eq(screenshots.buildId, buildId))
}

export async function getBuild(db: Database, buildId: string): Promise<Build | undefined> {
  const [row] = await db.select().from(builds).where(eq(builds.id, buildId))
  return row
}

export async function getProjectById(
  db: Database,
  projectId: string,
): Promise<ProjectRow | undefined> {
  const [row] = await db.select().from(projects).where(eq(projects.id, projectId))
  return row
}

export async function setBuildBaseline(
  db: Database,
  buildId: string,
  baseline: {
    baseBuildId: string | null
    baselineSource: 'cli' | 'sdk' | 'provider' | 'fallback' | 'none'
  },
): Promise<void> {
  await db.update(builds).set(baseline).where(eq(builds.id, buildId))
}

export type NewDiff = typeof screenshotDiffs.$inferInsert

/** Replaces a build's diff rows (processing is idempotent, so a retried job starts clean). */
export async function replaceBuildDiffs(
  db: Database,
  buildId: string,
  diffs: NewDiff[],
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(screenshotDiffs).where(eq(screenshotDiffs.buildId, buildId))
    if (diffs.length > 0) await tx.insert(screenshotDiffs).values(diffs)
  })
}

export async function updateDiff(
  db: Database,
  diffId: string,
  values: Partial<
    Pick<
      NewDiff,
      | 'status'
      | 'score'
      | 'changedPixels'
      | 'sizeChanged'
      | 'diffFileSha256'
      | 'jobStatus'
      | 'errorMessage'
    >
  >,
): Promise<void> {
  await db.update(screenshotDiffs).set(values).where(eq(screenshotDiffs.id, diffId))
}

export async function setScreenshotThumbnail(
  db: Database,
  screenshotId: string,
  sha256: string,
): Promise<void> {
  await db
    .update(screenshots)
    .set({ thumbnailSha256: sha256 })
    .where(eq(screenshots.id, screenshotId))
}

/**
 * Finishes a build. On the project's default branch with auto-approve on, a build with changes
 * is approved automatically (recorded as an `auto` review) so it becomes the next baseline.
 */
export async function completeBuild(
  db: Database,
  build: Build,
  result: { conclusion: 'no_changes' | 'changes_detected'; autoApprove: boolean },
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .update(builds)
      .set({
        status: 'complete',
        conclusion: result.conclusion,
        completedAt: new Date(),
        errorMessage: null,
        ...(result.autoApprove ? { reviewStatus: 'approved' as const } : {}),
      })
      .where(eq(builds.id, build.id))
    if (result.autoApprove) {
      await tx.insert(reviews).values({ buildId: build.id, state: 'approved', source: 'auto' })
    }
  })
}

export async function failBuild(db: Database, buildId: string, message: string): Promise<void> {
  await db
    .update(builds)
    .set({ status: 'error', errorMessage: message.slice(0, 2000), completedAt: new Date() })
    .where(eq(builds.id, buildId))
}
