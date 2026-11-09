import { deriveReviewStatus, assertFound } from '@circi/core'
import { and, eq, isNull, ne } from 'drizzle-orm'

import {
  builds,
  type ReviewSource,
  type ReviewState,
  type ReviewStatus,
  reviews,
  screenshotDiffs,
  snapshotReviews,
  user,
} from '#schema/index.ts'
import type { Database } from '#src/client.ts'
import { ConflictError } from '#src/errors.ts'
import type { Build } from '#src/types.ts'

/**
 * Approving and rejecting snapshots and builds (PLAN §7.4). A decision is stored per snapshot
 * (`snapshot_reviews`); the build's `review_status` is derived from them, and `reviews` keeps a
 * row each time that derived status becomes approved or rejected. The status is what makes an
 * approved build a baseline for later builds and what the merge gate reads.
 */

/**
 * Records decisions on snapshots of a build, then derives the build's `review_status` from the
 * current decision of each changed snapshot (`deriveReviewStatus` in `@circi/core`), in the same
 * transaction. Only a finished build with changes can be reviewed, and only its changed
 * snapshots can be decided. Deciding a snapshot the same way again changes nothing, so a double
 * click doesn't pile up history; changing your mind supersedes the earlier decision (kept for the
 * timeline). `changed` is true when the build's derived status moved. Data only: announcing a
 * decision is `reviewSnapshots` in `@circi/services`.
 */
export async function recordSnapshotReviews(
  db: Database,
  input: recordSnapshotReviews.Input,
): Promise<recordSnapshotReviews.Result> {
  return db.transaction(async (tx) => {
    const [build] = await tx.select().from(builds).where(eq(builds.id, input.buildId)).for('update')
    assertFound(build, 'Build not found')
    if (build.status !== 'complete') {
      throw new ConflictError(
        `Build #${build.number} is ${build.status}; it can be reviewed once it's complete`,
      )
    }
    if (build.conclusion !== 'changes_detected') {
      throw new ConflictError(`Build #${build.number} has no changes to review`)
    }
    const changed = await listChangedSnapshotNames(tx, build.id)
    const current = await currentDecisions(tx, build.id)

    let names: string[]
    if (input.snapshotNames === 'all') names = changed
    else if (input.snapshotNames === 'undecided') names = changed.filter((n) => !current.has(n))
    else {
      names = [...new Set(input.snapshotNames)]
      const unknown = names.filter((n) => !changed.includes(n))
      if (unknown.length > 0) {
        throw new ConflictError(`Not a changed snapshot of build #${build.number}: ${unknown[0]}`)
      }
    }

    const reason = input.decision === 'rejected' ? input.reason || null : null
    const decided: string[] = []
    const now = new Date()
    for (const name of names) {
      if (current.get(name)?.decision === input.decision) continue
      // eslint-disable-next-line no-await-in-loop -- one transaction, one connection
      await tx
        .update(snapshotReviews)
        .set({ supersededAt: now })
        .where(
          and(
            eq(snapshotReviews.buildId, build.id),
            eq(snapshotReviews.snapshotName, name),
            isNull(snapshotReviews.supersededAt),
          ),
        )
      // eslint-disable-next-line no-await-in-loop -- one transaction, one connection
      await tx.insert(snapshotReviews).values({
        buildId: build.id,
        snapshotName: name,
        decision: input.decision,
        userId: input.userId,
        source: input.source ?? 'ui',
        reason,
        createdAt: now,
      })
      current.set(name, { decision: input.decision, reason })
      decided.push(name)
    }

    const status = deriveReviewStatus({
      changed,
      decisions: new Map([...current].map(([n, c]) => [n, c.decision])),
    })
    const previousStatus = build.reviewStatus
    if (status === previousStatus) {
      return { build, changed: false, previousStatus, decided, reviewerName: null, reasons: [] }
    }
    const [updated] = await tx
      .update(builds)
      .set({ reviewStatus: status })
      .where(eq(builds.id, build.id))
      .returning()
    if (!updated) throw new Error('update returned no row')
    const reasons = [
      ...new Set(
        changed
          .map((n) => current.get(n))
          .filter((c) => c?.decision === 'rejected' && c.reason)
          .map((c) => c?.reason ?? ''),
      ),
    ]
    if (status !== 'pending') {
      await tx.insert(reviews).values({
        buildId: build.id,
        userId: input.userId,
        state: status,
        source: input.source ?? 'ui',
        reason: status === 'rejected' ? reasons.join('\n') || null : null,
      })
    }
    const [reviewer] = input.userId
      ? await tx.select({ name: user.name }).from(user).where(eq(user.id, input.userId))
      : []
    return {
      build: updated,
      changed: true,
      previousStatus,
      decided,
      reviewerName: reviewer?.name ?? null,
      reasons,
    }
  })
}

export namespace recordSnapshotReviews {
  export interface Input {
    buildId: string
    /** Null for automatic decisions. */
    userId: string | null
    decision: ReviewState
    /** Names to decide; `all` is every changed snapshot, `undecided` those with no decision yet. */
    snapshotNames: string[] | 'all' | 'undecided'
    source?: ReviewSource
    /** Why the snapshots were rejected; stored only with a rejection. */
    reason?: string | null
  }

  export interface Result {
    build: Build
    /** True when the build's derived review status moved. */
    changed: boolean
    previousStatus: ReviewStatus
    /** The snapshots whose decision actually changed. */
    decided: string[]
    reviewerName: string | null
    /** The reasons of the rejected snapshots (only when `changed`). */
    reasons: string[]
  }
}

/**
 * A decision on the whole build: every changed snapshot is decided the same way (replacing
 * earlier decisions). Kept so build-level callers (git host actions, bulk review) read as before.
 */
export async function recordReview(
  db: Database,
  input: recordReview.Input,
): Promise<recordSnapshotReviews.Result> {
  const { state, ...rest } = input
  return recordSnapshotReviews(db, { ...rest, decision: state, snapshotNames: 'all' })
}
export namespace recordReview {
  export interface Input {
    buildId: string
    userId: string | null
    state: ReviewState
    source?: ReviewSource
    reason?: string | null
  }
}

/** Names of a build's snapshots that differ from the baseline (everything but unchanged). */
export async function listChangedSnapshotNames(db: Database, buildId: string): Promise<string[]> {
  const rows = await db
    .select({ name: screenshotDiffs.name })
    .from(screenshotDiffs)
    .where(and(eq(screenshotDiffs.buildId, buildId), ne(screenshotDiffs.status, 'unchanged')))
    .orderBy(screenshotDiffs.name)
  return rows.map((r) => r.name)
}

async function currentDecisions(db: Database, buildId: string) {
  const rows = await db
    .select()
    .from(snapshotReviews)
    .where(and(eq(snapshotReviews.buildId, buildId), isNull(snapshotReviews.supersededAt)))
  return new Map(rows.map((r) => [r.snapshotName, { decision: r.decision, reason: r.reason }]))
}

/**
 * Approves every changed snapshot of a build with an automatic source and no reviewer, as part
 * of finishing it (default-branch auto-approve, an approved re-run).
 */
export async function approveChangedSnapshots(
  db: Database,
  buildId: string,
  source: 'auto' | 'rerun',
): Promise<void> {
  const names = await listChangedSnapshotNames(db, buildId)
  if (names.length === 0) return
  await db.insert(snapshotReviews).values(
    names.map((snapshotName) => ({
      buildId,
      snapshotName,
      decision: 'approved' as const,
      userId: null,
      source,
    })),
  )
}

/** Puts every current snapshot decision of a build into history (the build is being re-diffed). */
export async function supersedeSnapshotReviews(db: Database, buildId: string): Promise<void> {
  await db
    .update(snapshotReviews)
    .set({ supersededAt: new Date() })
    .where(and(eq(snapshotReviews.buildId, buildId), isNull(snapshotReviews.supersededAt)))
}
