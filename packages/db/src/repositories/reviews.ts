import { deriveReviewStatus, assertFound } from '@circi/core'
import { and, desc, eq, inArray, isNull, ne } from 'drizzle-orm'

import {
  builds,
  type ReviewSource,
  type ReviewState,
  type ReviewStatus,
  reviews,
  screenshotDiffs,
  snapshotReviews,
  projects,
  user,
} from '#schema/index.ts'
import type { Database } from '#src/client.ts'
import { ConflictError } from '#src/errors.ts'
import type { Build } from '#src/types.ts'

import { refreshTriageProblems } from './triage-problems.ts'

/**
 * Approving and rejecting snapshots and builds (PLAN §7.4). A decision is stored per snapshot
 * (`snapshot_reviews`); the build's `review_status` is derived from them, and `reviews` keeps a
 * row each time that derived status becomes approved or rejected. The status is what makes an
 * approved build a baseline for later builds and what the merge gate reads.
 */

/** Rows per INSERT/UPDATE: each row binds under 10 parameters, and Postgres allows 65535. */
const SNAPSHOT_REVIEW_CHUNK = 5000

function* chunks<T>(items: T[], size: number): Generator<T[]> {
  for (let i = 0; i < items.length; i += size) yield items.slice(i, i + size)
}

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
    const result = await decideSnapshots(tx, input)
    // The queue's no-baseline problems depend on what is approved.
    await refreshTriageProblems(tx, result.build.projectId, { branch: result.build.branch })
    return result
  })
}

async function decideSnapshots(
  tx: Database,
  input: recordSnapshotReviews.Input,
): Promise<recordSnapshotReviews.Result> {
  const [build] = await tx.select().from(builds).where(eq(builds.id, input.buildId)).for('update')
  assertFound(build, 'Build not found')
  if (build.status !== 'complete') {
    throw new ConflictError(
      `Build #${build.number} is ${build.status}; it can be reviewed once it's complete`,
    )
  }
  if (build.conclusion !== 'changes_detected') {
    const [project] = await tx
      .select({ autoApprove: projects.autoApproveNoChanges })
      .from(projects)
      .where(eq(projects.id, build.projectId))
    // A project that doesn't approve no-change builds on their own has them decided by a person:
    // there are no snapshots to decide, so the decision is the build's.
    if (build.conclusion === 'no_changes' && project && !project.autoApprove) {
      return decideBuildWithoutChanges(tx, build, input)
    }
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
  const insertedIds: string[] = []
  const supersededIds: string[] = []
  const now = new Date()
  const toDecide = names.filter((name) => current.get(name)?.decision !== input.decision)
  // Set-based: one UPDATE for everything superseded, then multi-row INSERTs (chunked under
  // Postgres's bind-parameter limit), so the statement count doesn't grow with the snapshots.
  for (const chunk of chunks(toDecide, SNAPSHOT_REVIEW_CHUNK)) {
    // eslint-disable-next-line no-await-in-loop -- one transaction, one connection
    const replaced = await tx
      .update(snapshotReviews)
      .set({ supersededAt: now })
      .where(
        and(
          eq(snapshotReviews.buildId, build.id),
          inArray(snapshotReviews.snapshotName, chunk),
          isNull(snapshotReviews.supersededAt),
        ),
      )
      .returning({ id: snapshotReviews.id })
    supersededIds.push(...replaced.map((r) => r.id))
    // eslint-disable-next-line no-await-in-loop -- one transaction, one connection
    const rows = await tx
      .insert(snapshotReviews)
      .values(
        chunk.map((snapshotName) => ({
          buildId: build.id,
          snapshotName,
          decision: input.decision,
          userId: input.userId,
          source: input.source ?? ('ui' as const),
          reason,
          createdAt: now,
        })),
      )
      .returning({ id: snapshotReviews.id })
    insertedIds.push(...rows.map((r) => r.id))
  }
  for (const name of toDecide) current.set(name, { decision: input.decision, reason })
  decided.push(...toDecide)

  const status = deriveReviewStatus({
    changed,
    decisions: new Map([...current].map(([n, c]) => [n, c.decision])),
  })
  const previousStatus = build.reviewStatus
  if (status === previousStatus) {
    return {
      build,
      changed: false,
      previousStatus,
      decided,
      reviewerName: null,
      reasons: [],
      insertedIds,
      supersededIds,
      reviewId: null,
    }
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
  let reviewId: string | null = null
  if (status !== 'pending') {
    const [row] = await tx
      .insert(reviews)
      .values({
        buildId: build.id,
        userId: input.userId,
        state: status,
        source: input.source ?? 'ui',
        reason: status === 'rejected' ? reasons.join('\n') || null : null,
      })
      .returning({ id: reviews.id })
    reviewId = row?.id ?? null
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
    insertedIds,
    supersededIds,
    reviewId,
  }
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
    /** The decision rows this call wrote, and the ones it put into history (for `restoreSnapshotReviews`). */
    insertedIds: string[]
    supersededIds: string[]
    /** The `reviews` row written when the build's status became approved or rejected. */
    reviewId: string | null
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

/**
 * Names of a build's snapshots that differ from the baseline and so need a decision: everything
 * but unchanged and failed (a screenshot the server couldn't read has nothing to approve, and
 * must never become a baseline).
 */
export async function listChangedSnapshotNames(db: Database, buildId: string): Promise<string[]> {
  const rows = await db
    .select({ name: screenshotDiffs.name })
    .from(screenshotDiffs)
    .where(
      and(
        eq(screenshotDiffs.buildId, buildId),
        ne(screenshotDiffs.status, 'unchanged'),
        ne(screenshotDiffs.status, 'failed'),
      ),
    )
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

/** A person's approval or rejection of a build with no changes (see `recordSnapshotReviews`). */
async function decideBuildWithoutChanges(
  db: Database,
  build: Build,
  input: recordSnapshotReviews.Input,
): Promise<recordSnapshotReviews.Result> {
  const previousStatus = build.reviewStatus
  if (input.decision === previousStatus) {
    return {
      build,
      changed: false,
      previousStatus,
      decided: [],
      reviewerName: null,
      reasons: [],
      insertedIds: [],
      supersededIds: [],
      reviewId: null,
    }
  }
  const reason = input.decision === 'rejected' ? input.reason || null : null
  const [updated] = await db
    .update(builds)
    .set({ reviewStatus: input.decision })
    .where(eq(builds.id, build.id))
    .returning()
  if (!updated) throw new Error('update returned no row')
  const [written] = await db
    .insert(reviews)
    .values({
      buildId: build.id,
      userId: input.userId,
      state: input.decision,
      source: input.source ?? 'ui',
      reason,
    })
    .returning({ id: reviews.id })
  const [reviewer] = input.userId
    ? await db.select({ name: user.name }).from(user).where(eq(user.id, input.userId))
    : []
  return {
    build: updated,
    changed: true,
    previousStatus,
    decided: [],
    reviewerName: reviewer?.name ?? null,
    reasons: reason ? [reason] : [],
    insertedIds: [],
    supersededIds: [],
    reviewId: written?.id ?? null,
  }
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
  for (const chunk of chunks(names, SNAPSHOT_REVIEW_CHUNK)) {
    // eslint-disable-next-line no-await-in-loop -- sequential chunks of one logical insert
    await db.insert(snapshotReviews).values(
      chunk.map((snapshotName) => ({
        buildId,
        snapshotName,
        decision: 'approved' as const,
        userId: null,
        source,
      })),
    )
  }
}

/**
 * Carries the current decisions of an earlier build (a rejected one the new build is a re-run of)
 * onto the new build's changed snapshots, as `rerun` decisions with no person behind them, and
 * says what the build's status becomes. Nothing is written unless it comes out `rejected`: a
 * rejection that no longer applies (the baseline moved, so the rejected snapshot is unchanged)
 * is not carried.
 */
export async function carryRejection(
  db: Database,
  input: { fromBuildId: string; toBuildId: string },
): Promise<{ status: ReviewStatus; reasons: string[] }> {
  const changed = await listChangedSnapshotNames(db, input.toBuildId)
  const earlier = await currentDecisions(db, input.fromBuildId)
  const carried = changed.filter((n) => earlier.has(n))
  const status = deriveReviewStatus({
    changed,
    decisions: new Map(carried.map((n) => [n, earlier.get(n)?.decision ?? 'approved'])),
  })
  if (status !== 'rejected') return { status: 'pending', reasons: [] }
  await db.insert(snapshotReviews).values(
    carried.map((snapshotName) => {
      const d = earlier.get(snapshotName)
      return {
        buildId: input.toBuildId,
        snapshotName,
        decision: d?.decision ?? 'approved',
        userId: null,
        source: 'rerun' as const,
        reason: d?.decision === 'rejected' ? d.reason : null,
      }
    }),
  )
  const reasons = [
    ...new Set(
      carried
        .map((n) => earlier.get(n))
        .filter((d) => d?.decision === 'rejected' && d.reason)
        .map((d) => d?.reason ?? ''),
    ),
  ]
  return { status: 'rejected', reasons }
}

/** Puts every current snapshot decision of a build into history (the build is being re-diffed). */
export async function supersedeSnapshotReviews(db: Database, buildId: string): Promise<void> {
  await db
    .update(snapshotReviews)
    .set({ supersededAt: new Date() })
    .where(and(eq(snapshotReviews.buildId, buildId), isNull(snapshotReviews.supersededAt)))
}

export namespace getBuildReviewSummary {
  export interface Summary {
    /** Changed snapshots with a current approve / reject decision, and those still undecided. */
    approved: number
    rejected: number
    pending: number
    /** Who made the decision that set the build's current status; null for automatic ones. */
    decidedBy: string | null
  }
}

/**
 * How far a build's review has come, for the pull request comment: the current decisions on its
 * changed snapshots, and the name of whoever made the latest approval or rejection.
 */
export async function getBuildReviewSummary(
  db: Database,
  buildId: string,
): Promise<getBuildReviewSummary.Summary> {
  const changed = await listChangedSnapshotNames(db, buildId)
  const current = await currentDecisions(db, buildId)
  let approved = 0
  let rejected = 0
  for (const name of changed) {
    const decision = current.get(name)?.decision
    if (decision === 'approved') approved += 1
    else if (decision === 'rejected') rejected += 1
  }
  const [last] = await db
    .select({ name: user.name })
    .from(reviews)
    .leftJoin(user, eq(user.id, reviews.userId))
    .where(eq(reviews.buildId, buildId))
    .orderBy(desc(reviews.createdAt))
    .limit(1)
  return {
    approved,
    rejected,
    pending: changed.length - approved - rejected,
    decidedBy: last?.name ?? null,
  }
}

/**
 * Takes back what one `recordSnapshotReviews` call did: the decision rows it wrote go into
 * history and the ones it had put there come back as current, with their reasons as they were.
 * Then the build's review status is derived again (`deriveReviewStatus`), or, for a build decided
 * as a whole (no changed snapshots), set back to `previousStatus`. `stale` is true, and nothing
 * is changed, when something newer decided the same snapshots (or the build) in between.
 */
export async function restoreSnapshotReviews(
  db: Database,
  input: restoreSnapshotReviews.Input,
): Promise<restoreSnapshotReviews.Result> {
  return db.transaction(async (tx) => {
    const result = await restoreDecisions(tx, input)
    if (!result.stale) {
      await refreshTriageProblems(tx, result.build.projectId, { branch: result.build.branch })
    }
    return result
  })
}

async function restoreDecisions(
  tx: Database,
  input: restoreSnapshotReviews.Input,
): Promise<restoreSnapshotReviews.Result> {
  const [build] = await tx.select().from(builds).where(eq(builds.id, input.buildId)).for('update')
  assertFound(build, 'Build not found')
  const previousStatus = build.reviewStatus
  if (input.insertedIds.length === 0) {
    // A build decided as a whole: its status is the decision.
    if (build.reviewStatus !== input.resultStatus) return { stale: true, build, changed: false }
    const [updated] = await tx
      .update(builds)
      .set({ reviewStatus: input.previousStatus })
      .where(eq(builds.id, build.id))
      .returning()
    return {
      stale: false,
      build: updated ?? build,
      changed: input.previousStatus !== previousStatus,
    }
  }
  const live = await tx
    .select({ id: snapshotReviews.id })
    .from(snapshotReviews)
    .where(
      and(inArray(snapshotReviews.id, input.insertedIds), isNull(snapshotReviews.supersededAt)),
    )
  if (live.length !== input.insertedIds.length) return { stale: true, build, changed: false }
  await tx
    .update(snapshotReviews)
    .set({ supersededAt: new Date() })
    .where(inArray(snapshotReviews.id, input.insertedIds))
  if (input.supersededIds.length > 0) {
    await tx
      .update(snapshotReviews)
      .set({ supersededAt: null })
      .where(inArray(snapshotReviews.id, input.supersededIds))
  }
  // The status the action left is exactly what undoing it puts back; if others moved it on
  // (they decided other snapshots), it follows the decisions as they now are.
  let status: ReviewStatus = input.previousStatus
  if (build.reviewStatus !== input.resultStatus) {
    status = deriveReviewStatus({
      changed: await listChangedSnapshotNames(tx, build.id),
      decisions: new Map(
        [...(await currentDecisions(tx, build.id))].map(([n, c]) => [n, c.decision]),
      ),
    })
  }
  if (status === previousStatus) return { stale: false, build, changed: false }
  const [updated] = await tx
    .update(builds)
    .set({ reviewStatus: status })
    .where(eq(builds.id, build.id))
    .returning()
  return { stale: false, build: updated ?? build, changed: true }
}
export namespace restoreSnapshotReviews {
  export interface Input {
    buildId: string
    insertedIds: string[]
    supersededIds: string[]
    /** The build's review status before the action, and the one the action left. */
    previousStatus: ReviewStatus
    resultStatus: ReviewStatus
  }
  export interface Result {
    stale: boolean
    build: Build
    /** True when the build's review status moved. */
    changed: boolean
  }
}
