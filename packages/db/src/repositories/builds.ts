import { checkBuildInput, MAX_PARALLEL_SHARDS, resolveBaseline, ValidationError } from '@circi/core'
import { and, desc, eq, inArray, lt, ne, sql } from 'drizzle-orm'

import type { Database } from '../client.ts'
import { ConflictError, isUniqueViolation, NotFoundError } from '../errors.ts'
import {
  type BaselineSource,
  type BuildConclusion,
  buildShards,
  builds,
  files,
  projects,
  reviews,
  screenshotDiffs,
  screenshots,
  uploadClaims,
} from '../schema/index.ts'
import type { Build } from '../types.ts'

/** Build lifecycle: create (or join a parallel build), finalize shards, baseline, finish. */

/**
 * Creates a build, or joins the existing one for parallel shards (PLAN §7.1 step 4): shards
 * that start at the same moment hit the unique (project, name, commit, nonce) index and all
 * get the same build.
 */
export async function createBuild(db: Database, input: createBuild.Input): Promise<Build> {
  const { name, commitSha, ancestorShas } = checkBuildInput({
    name: input.name,
    commitSha: input.commitSha,
    ancestorShas: input.ancestorShas,
    parallelTotal: input.parallel?.total,
  })

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
    historySource: input.historySource ?? 'cli',
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

export namespace createBuild {
  export interface Input {
    projectId: string
    name?: string
    commitSha: string
    branch?: string | null
    prNumber?: number | null
    baseBranch?: string | null
    mergeBaseSha?: string | null
    ancestorShas?: string[]
    ancestryStatus?: 'ok' | 'missing' | 'truncated'
    /** Who sent `ancestorShas`; `sdk` for an Argos SDK. Default `cli`. */
    historySource?: 'cli' | 'sdk'
    parallel?: { nonce: string; total: number }
  }
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

export async function getBuild(db: Database, buildId: string): Promise<Build | undefined> {
  const [row] = await db.select().from(builds).where(eq(builds.id, buildId))
  return row
}

/** A build by its per-project number, the number people see in URLs and on screen. */
export async function getBuildByNumber(
  db: Database,
  projectId: string,
  number: number,
): Promise<Build | undefined> {
  const [row] = await db
    .select()
    .from(builds)
    .where(and(eq(builds.projectId, projectId), eq(builds.number, number)))
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

const SCREENSHOT_NAME_RE = /^[^\0\n\r]{1,512}$/

/**
 * Records one shard's screenshots (PLAN §7.1 step 6). A retried shard replaces its own
 * screenshots instead of being counted twice. When every shard is in, the build moves to
 * `processing` and the processing job is enqueued in the same transaction.
 */
/**
 * Stores one shard's screenshots, and moves the build to `processing` once the last shard is
 * in. Data only: the caller (`finalizeBuild` in `@circi/services`) decides what else must happen
 * in the same transaction, such as queueing the diff job.
 */
export async function finalizeShard(
  db: Database,
  input: {
    buildId: string
    shardIndex?: string
    screenshots: finalizeShard.Screenshot[]
    /** Add to this shard's screenshots instead of replacing them (chunked uploads). */
    append?: boolean
    /** Store the screenshots but don't count the shard as finished yet. */
    hold?: boolean
  },
): Promise<finalizeShard.Result> {
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

    if (!input.append) {
      await tx
        .delete(screenshots)
        .where(and(eq(screenshots.buildId, build.id), eq(screenshots.shardIndex, shardIndex)))
    }
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

    if (input.hold) {
      if (build.status === 'pending') {
        await tx.update(builds).set({ status: 'uploading' }).where(eq(builds.id, build.id))
      }
      const [received = { count: 0 }] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(buildShards)
        .where(eq(buildShards.buildId, build.id))
      return {
        status: 'ok',
        complete: false,
        shardsReceived: received.count,
        shardsTotal: build.parallelTotal ?? 1,
      }
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
      return {
        status: 'ok',
        complete: true,
        shardsReceived: count,
        shardsTotal: total,
        build: { ...build, status: 'processing' },
      }
    } else if (build.status === 'pending') {
      await tx.update(builds).set({ status: 'uploading' }).where(eq(builds.id, build.id))
    }
    return { status: 'ok', complete, shardsReceived: count, shardsTotal: total }
  })
}

export namespace finalizeShard {
  export interface Screenshot {
    name: string
    sha256: string
    metadata?: Record<string, unknown>
  }

  export type Result =
    | {
        status: 'ok'
        complete: boolean
        shardsReceived: number
        shardsTotal: number
        /** The build, now `processing`, when this shard was the last one. */
        build?: Build
      }
    /** Some files aren't verified yet: the client must (re)upload them. */
    | { status: 'missing'; missing: string[] }
}

export async function getBuildCounts(
  db: Database,
  buildId: string,
): Promise<getBuildCounts.Counts> {
  const rows = await db
    .select({ status: screenshotDiffs.status, n: sql<number>`count(*)::int` })
    .from(screenshotDiffs)
    .where(eq(screenshotDiffs.buildId, buildId))
    .groupBy(screenshotDiffs.status)
  const counts: getBuildCounts.Counts = {
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

export namespace getBuildCounts {
  export interface Counts {
    added: number
    removed: number
    changed: number
    unchanged: number
    failed: number
    total: number
  }
}

/** Possible baselines: same project and name, finished, not the build itself. */
export async function listBaselineCandidates(
  db: Database,
  build: Pick<Build, 'projectId' | 'name' | 'ancestorShas'> & { id?: string },
): Promise<Build[]> {
  const conditions = [
    eq(builds.projectId, build.projectId),
    eq(builds.name, build.name),
    eq(builds.status, 'complete'),
    ...(build.id ? [ne(builds.id, build.id)] : []),
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

export async function setBuildBaseline(
  db: Database,
  buildId: string,
  baseline: {
    baseBuildId: string | null
    baselineSource: BaselineSource
  },
): Promise<void> {
  await db.update(builds).set(baseline).where(eq(builds.id, buildId))
}

/**
 * Finishes a build. On the project's default branch with auto-approve on, a build with changes
 * is approved automatically (recorded as an `auto` review) so it becomes the next baseline.
 */
/**
 * Records a processed build's outcome, approving it at once when `approval` says so. Data only:
 * announcing the result is `completeBuild` in `@circi/services`.
 */
export async function setBuildResult(
  db: Database,
  build: Build,
  result: { conclusion: BuildConclusion; approval: setBuildResult.Approval },
): Promise<Build> {
  return db.transaction(async (tx) => {
    const approved = result.approval !== 'none'
    await tx
      .update(builds)
      .set({
        status: 'complete',
        conclusion: result.conclusion,
        completedAt: new Date(),
        errorMessage: null,
        ...(approved ? { reviewStatus: 'approved' as const } : {}),
      })
      .where(eq(builds.id, build.id))
    if (approved) {
      await tx.insert(reviews).values({
        buildId: build.id,
        state: 'approved',
        source: result.approval === 'rerun' ? 'rerun' : 'auto',
      })
    }
    const [done] = await tx.select().from(builds).where(eq(builds.id, build.id))
    if (!done) throw new NotFoundError('Build not found')
    return done
  })
}
export namespace setBuildResult {
  /** Why a finished build starts out approved without anyone clicking. */
  export type Approval = 'none' | 'default-branch' | 'rerun'
}

/**
 * The earlier build that makes this one an approved re-run, if any: same project, build name and
 * commit, currently approved, with exactly the same screenshots (same names, same bytes). This
 * is what lets "approve in the dashboard, then re-run the CI job" go green: the re-run is a new
 * build, but nothing in it is new to the reviewer. A different commit, a different screenshot or
 * a rejected earlier build never qualifies.
 */
export async function findApprovedRerunOf(db: Database, build: Build): Promise<string | undefined> {
  const earlier = await db
    .select({ id: builds.id })
    .from(builds)
    .where(
      and(
        eq(builds.projectId, build.projectId),
        eq(builds.name, build.name),
        eq(builds.commitSha, build.commitSha),
        eq(builds.status, 'complete'),
        eq(builds.reviewStatus, 'approved'),
        ne(builds.id, build.id),
      ),
    )
    .orderBy(desc(builds.createdAt))
  if (earlier.length === 0) return undefined
  const signature = async (buildId: string) => {
    const rows = await db
      .select({ name: screenshots.name, sha: screenshots.fileSha256 })
      .from(screenshots)
      .where(eq(screenshots.buildId, buildId))
    return rows
      .map((r) => `${r.name}\0${r.sha}`)
      .toSorted()
      .join('\n')
  }
  const mine = await signature(build.id)
  for (const candidate of earlier) {
    // oxlint-disable-next-line no-await-in-loop -- stops at the first match; there are rarely more than a couple
    if ((await signature(candidate.id)) === mine) return candidate.id
  }
  return undefined
}

/** Marks a build as failed; returns it, or nothing if it no longer exists. */
export async function setBuildError(
  db: Database,
  buildId: string,
  message: string,
): Promise<Build | undefined> {
  const [failed] = await db
    .update(builds)
    .set({ status: 'error', errorMessage: message.slice(0, 2000), completedAt: new Date() })
    .where(eq(builds.id, buildId))
    .returning()
  return failed
}

/**
 * Puts a finished build back to `processing` with no decision, so it can be diffed again
 * (e.g. after changing the diff threshold). Data only: queueing the job is `requeueBuild` in
 * `@circi/services`.
 */
export async function resetBuild(db: Database, buildId: string): Promise<Build> {
  const [updated] = await db
    .update(builds)
    .set({
      status: 'processing',
      conclusion: null,
      reviewStatus: 'pending',
      completedAt: null,
      errorMessage: null,
    })
    .where(and(eq(builds.id, buildId), inArray(builds.status, ['complete', 'error'])))
    .returning()
  if (!updated) throw new NotFoundError('Build not found, or still processing')
  return updated
}

/**
 * Sets how many shards a parallel build has. Argos SDKs only learn the total when the last
 * shard reports, so a build starts with the most it could have and is corrected here.
 */
export async function setParallelTotal(
  db: Database,
  buildId: string,
  total: number,
): Promise<void> {
  const clamped = Math.min(Math.max(Math.trunc(total), 1), MAX_PARALLEL_SHARDS)
  await db
    .update(builds)
    .set({ parallelTotal: clamped })
    .where(and(eq(builds.id, buildId), inArray(builds.status, ['pending', 'uploading'])))
}

/**
 * The baseline an Argos SDK asks for: the newest eligible build of this project and build name
 * on one of `commits` (nearest first), if any.
 */
export async function findBaselineByCommits(
  db: Database,
  input: { projectId: string; name: string; commits: string[] },
): Promise<{ id: string; commitSha: string; branch: string | null } | undefined> {
  const candidates = await listBaselineCandidates(db, {
    projectId: input.projectId,
    name: input.name,
    ancestorShas: input.commits,
  })
  const project = await db
    .select({ defaultBranch: projects.defaultBranch })
    .from(projects)
    .where(eq(projects.id, input.projectId))
  const resolved = resolveBaseline(
    { ancestorShas: input.commits, defaultBranch: project[0]?.defaultBranch ?? 'main' },
    candidates,
  )
  return resolved.via === 'none' ? undefined : resolved.build
}

/** A build that was never finished, with the shards it did receive. */
export interface StalledBuild {
  build: Build
  /** Indexes of the shards that arrived. */
  receivedShards: string[]
}

/** Builds still waiting for uploads that were created before `cutoff`. */
export async function listStalledBuilds(db: Database, cutoff: Date): Promise<StalledBuild[]> {
  const stalled = await db
    .select()
    .from(builds)
    .where(and(inArray(builds.status, ['pending', 'uploading']), lt(builds.createdAt, cutoff)))
  if (stalled.length === 0) return []
  const shards = await db
    .select({ buildId: buildShards.buildId, shardIndex: buildShards.shardIndex })
    .from(buildShards)
    .where(
      inArray(
        buildShards.buildId,
        stalled.map((b) => b.id),
      ),
    )
  return stalled.map((build) => ({
    build,
    receivedShards: shards.filter((s) => s.buildId === build.id).map((s) => s.shardIndex),
  }))
}
