import { and, desc, eq, inArray, ne } from 'drizzle-orm'

import { type BuildConclusion, builds, reviews, screenshots } from '#schema/index.ts'
import type { Database } from '#src/client.ts'
import { assertFound } from '#src/errors.ts'
import type { Build } from '#src/types.ts'

import { approveChangedSnapshots, supersedeSnapshotReviews } from './reviews.ts'

/** Recording how a build ended, and resetting it for another run. */

/**
 * Finishes a build. On the team's default branch with auto-approve on, a build with changes
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
      await approveChangedSnapshots(tx, build.id, result.approval === 'rerun' ? 'rerun' : 'auto')
    }
    const [done] = await tx.select().from(builds).where(eq(builds.id, build.id))
    assertFound(done, 'Build not found')
    return done
  })
}

export namespace setBuildResult {
  /** Why a finished build starts out approved without anyone clicking. */
  export type Approval = 'none' | 'default-branch' | 'rerun'
}

/**
 * The earlier build that makes this one an approved re-run, if any: same team, build name and
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
        eq(builds.teamId, build.teamId),
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
  assertFound(updated, 'Build not found, or still processing')
  await supersedeSnapshotReviews(db, buildId)
  return updated
}
