import type { FlakyDecision } from '@circi/core'
import { and, desc, eq, inArray, ne } from 'drizzle-orm'

import { type BuildConclusion, builds, reviews, screenshots } from '#schema/index.ts'
import type { Database } from '#src/client.ts'
import { assertFound } from '#src/errors.ts'
import type { Build } from '#src/types.ts'

import { approveChangedSnapshots, carryRejection, supersedeSnapshotReviews } from './reviews.ts'
import { refreshTriageProblems } from './triage-problems.ts'

/** Recording how a build ended, and resetting it for another run. */

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
  result: setBuildResult.Input,
): Promise<Build> {
  return db.transaction(async (tx) => {
    const approved = result.approval === 'default-branch' || result.approval === 'rerun'
    await tx
      .update(builds)
      .set({
        status: 'complete',
        conclusion: result.conclusion,
        completedAt: new Date(),
        errorMessage: null,
        flakyDecision: result.flakyDecision ?? null,
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
    } else if (result.approval === 'rerun-rejected') {
      const carried = await carryRejection(tx, {
        fromBuildId: result.carriedFrom,
        toBuildId: build.id,
      })
      if (carried.status === 'rejected') {
        await tx.update(builds).set({ reviewStatus: 'rejected' }).where(eq(builds.id, build.id))
        await tx.insert(reviews).values({
          buildId: build.id,
          state: 'rejected',
          source: 'rerun',
          reason: carried.reasons.join('\n') || null,
        })
      }
    }
    const [done] = await tx.select().from(builds).where(eq(builds.id, build.id))
    assertFound(done, 'Build not found')
    await refreshTriageProblems(tx, done.projectId, { branch: done.branch })
    return done
  })
}

export namespace setBuildResult {
  /**
   * Why a finished build starts out decided without anyone clicking: approved on the default
   * branch, approved because the same commit's exact screenshots were approved, or rejected
   * because they were rejected (`carriedFrom` is that earlier build).
   */
  export type Approval = Input['approval']
  export type Input = {
    conclusion: BuildConclusion
    /** The flaky set the merge gate used (`buildFlakyDecision`), kept so later answers can't drift. */
    flakyDecision?: FlakyDecision
  } & (
    | { approval: 'none' | 'default-branch' | 'rerun' }
    | { approval: 'rerun-rejected'; carriedFrom: string }
  )
}

/**
 * The earlier build whose decision a re-run inherits, if any: same project, build name and commit,
 * currently approved or rejected, with exactly the same screenshots (same names, same bytes);
 * the newest such build decides. This is what lets "approve in the dashboard, then re-run the CI
 * job" go green, and "reject, then re-run" stay red: the re-run is a new build, but nothing in it
 * is new to the reviewer. A different commit or a different screenshot never qualifies, and
 * approving (or rejecting) a build later moves the decision with it.
 */
export async function findDecidedRerunOf(
  db: Database,
  build: Build,
): Promise<{ id: string; state: 'approved' | 'rejected' } | undefined> {
  const earlier = await db
    .select({ id: builds.id, reviewStatus: builds.reviewStatus })
    .from(builds)
    .where(
      and(
        eq(builds.projectId, build.projectId),
        eq(builds.name, build.name),
        eq(builds.commitSha, build.commitSha),
        eq(builds.status, 'complete'),
        inArray(builds.reviewStatus, ['approved', 'rejected']),
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
    if ((await signature(candidate.id)) === mine) {
      return {
        id: candidate.id,
        state: candidate.reviewStatus === 'rejected' ? 'rejected' : 'approved',
      }
    }
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
  if (failed) await refreshTriageProblems(db, failed.projectId, { branch: failed.branch })
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
      flakyDecision: null,
    })
    .where(and(eq(builds.id, buildId), inArray(builds.status, ['complete', 'error'])))
    .returning()
  assertFound(updated, 'Build not found, or still processing')
  await supersedeSnapshotReviews(db, buildId)
  await refreshTriageProblems(db, updated.projectId, { branch: updated.branch })
  return updated
}
