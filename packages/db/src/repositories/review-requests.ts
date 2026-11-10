import { ValidationError } from '@circi/core'
import {
  and,
  asc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  lt,
  not,
  notExists,
  or,
  sql,
} from 'drizzle-orm'

import { builds, member, notifications, teamMembers, teams, reviewRequests } from '#schema/index.ts'
import type { SnoozeKind } from '#schema/index.ts'
import type { Database } from '#src/client.ts'
import { assertFound, ConflictError } from '#src/errors.ts'
import type { ReviewRequest } from '#src/types.ts'

/**
 * Review requests: who was asked to look at which build, and whether they still need to. Data
 * only; telling people about a request or its end is `requestReview` and friends in
 * `@circi/services`. Every function that closes requests returns the rows it closed, so the
 * caller can announce exactly those.
 */

/**
 * Opens a request for `reviewerId` on a build. The reviewer must belong to the build's
 * team (`ValidationError` otherwise), and the build must still be reviewable (not failed or expired, and with changes).
 * Asking again while a request is open changes nothing (`created: false`); once it is closed,
 * asking makes a new one.
 */
export async function openReviewRequest(
  db: Database,
  input: openReviewRequest.Input,
): Promise<openReviewRequest.Result> {
  return db.transaction(async (tx) => {
    const [build] = await tx
      .select({
        id: builds.id,
        number: builds.number,
        status: builds.status,
        conclusion: builds.conclusion,
        workspaceId: teams.workspaceId,
        teamId: teams.id,
        autoApproveNoChanges: teams.autoApproveNoChanges,
      })
      .from(builds)
      .innerJoin(teams, eq(teams.id, builds.teamId))
      .where(eq(builds.id, input.buildId))
      .for('update', { of: builds })
    assertFound(build, 'Build not found')
    if (build.status === 'error' || build.status === 'expired') {
      throw new ConflictError(`Build #${build.number} is ${build.status}; it can't be reviewed`)
    }
    // A team that approves no-change builds by hand asks for reviews of them like any other.
    if (build.conclusion === 'no_changes' && build.autoApproveNoChanges) {
      throw new ConflictError(`Build #${build.number} has no changes to review`)
    }
    const [reviewer] = await tx
      .select({ id: teamMembers.userId })
      .from(teamMembers)
      .innerJoin(
        member,
        and(eq(member.workspaceId, build.workspaceId), eq(member.userId, teamMembers.userId)),
      )
      .where(and(eq(teamMembers.teamId, build.teamId), eq(teamMembers.userId, input.reviewerId)))
    if (!reviewer) throw new ValidationError('The reviewer must be a member of this team')

    const [created] = await tx
      .insert(reviewRequests)
      .values({
        buildId: input.buildId,
        reviewerId: input.reviewerId,
        requestedById: input.requestedById,
        dueAt: input.dueAt,
      })
      .onConflictDoNothing({
        target: [reviewRequests.buildId, reviewRequests.reviewerId],
        where: eq(reviewRequests.state, 'open'),
      })
      .returning()
    if (created) return { request: created, created: true }
    const [existing] = await tx
      .select()
      .from(reviewRequests)
      .where(
        and(
          eq(reviewRequests.buildId, input.buildId),
          eq(reviewRequests.reviewerId, input.reviewerId),
          eq(reviewRequests.state, 'open'),
        ),
      )
    if (!existing) throw new Error('open review request vanished')
    return { request: existing, created: false }
  })
}
export namespace openReviewRequest {
  export interface Input {
    buildId: string
    reviewerId: string
    /** Null when the system asked (a review rule or the triage rotation). */
    requestedById: string | null
    /** From the team's review target; null when it has none. */
    dueAt: Date | null
  }

  export interface Result {
    request: ReviewRequest
    /** False when the reviewer already had an open request for this build. */
    created: boolean
  }
}

/** Closes a build's open requests as `done` (the build was reviewed). Returns the ones it closed. */
export async function closeReviewRequestsForBuild(
  db: Database,
  buildId: string,
): Promise<ReviewRequest[]> {
  return db
    .update(reviewRequests)
    .set({ state: 'done', closedAt: sql`now()` })
    .where(and(eq(reviewRequests.buildId, buildId), eq(reviewRequests.state, 'open')))
    .returning()
}

/**
 * Closes the open requests on builds older than `beforeNumber` on the same branch of a team as
 * `superseded` (a newer build replaced them). Returns the ones it closed.
 */
export async function supersedeReviewRequests(
  db: Database,
  input: { teamId: string; branch: string; beforeNumber: number },
): Promise<ReviewRequest[]> {
  const older = db
    .select({ id: builds.id })
    .from(builds)
    .where(
      and(
        eq(builds.teamId, input.teamId),
        eq(builds.branch, input.branch),
        lt(builds.number, input.beforeNumber),
      ),
    )
  return db
    .update(reviewRequests)
    .set({ state: 'superseded', closedAt: sql`now()` })
    .where(and(eq(reviewRequests.state, 'open'), inArray(reviewRequests.buildId, older)))
    .returning()
}

/**
 * Drops an open request of a build in `teamId`. Only the reviewer or whoever asked may. Returns
 * the closed request, or undefined when there is nothing of theirs to dismiss (unknown, already
 * closed, in another team, or someone else's).
 */
export async function dismissReviewRequest(
  db: Database,
  input: { teamId: string; requestId: string; userId: string },
): Promise<ReviewRequest | undefined> {
  const inTeam = db.select({ id: builds.id }).from(builds).where(eq(builds.teamId, input.teamId))
  const [row] = await db
    .update(reviewRequests)
    .set({ state: 'dismissed', closedAt: sql`now()` })
    .where(
      and(
        eq(reviewRequests.id, input.requestId),
        eq(reviewRequests.state, 'open'),
        inArray(reviewRequests.buildId, inTeam),
        or(
          eq(reviewRequests.reviewerId, input.userId),
          eq(reviewRequests.requestedById, input.userId),
        ),
      ),
    )
    .returning()
  return row
}

/**
 * Sets (`until` and `kind`) or clears (`kind: null`) the snooze of an open request of a build in
 * `teamId`. Only the reviewer may. Returns the request, or undefined when there is nothing of
 * theirs to change (unknown, closed, in another team, or someone else's).
 */
export async function setReviewRequestSnooze(
  db: Database,
  input: {
    teamId: string
    requestId: string
    userId: string
    kind: SnoozeKind | null
    until: Date | null
  },
): Promise<ReviewRequest | undefined> {
  const inTeam = db.select({ id: builds.id }).from(builds).where(eq(builds.teamId, input.teamId))
  const [row] = await db
    .update(reviewRequests)
    .set({
      snoozeKind: input.kind,
      snoozedUntil: input.kind === null ? null : input.until,
    })
    .where(
      and(
        eq(reviewRequests.id, input.requestId),
        eq(reviewRequests.state, 'open'),
        eq(reviewRequests.reviewerId, input.userId),
        inArray(reviewRequests.buildId, inTeam),
      ),
    )
    .returning()
  return row
}

/**
 * Open requests past their due time at `now`, not snoozed, whose reviewer has not yet been told
 * they are overdue (no `review_overdue` notification carries the request's id). Rows are locked
 * (skipping ones another worker holds) until the transaction ends, so two sweeps never both
 * report the same request.
 */
export async function lockOverdueUnnotifiedRequests(
  db: Database,
  now: Date,
): Promise<ReviewRequest[]> {
  const told = db
    .select({ one: sql`1` })
    .from(notifications)
    .where(
      and(
        eq(notifications.kind, 'review_overdue'),
        eq(notifications.userId, reviewRequests.reviewerId),
        eq(notifications.buildId, reviewRequests.buildId),
        sql`${notifications.payload} ->> 'requestId' = ${reviewRequests.id}::text`,
      ),
    )
  return db
    .select()
    .from(reviewRequests)
    .where(
      and(
        eq(reviewRequests.state, 'open'),
        lt(reviewRequests.dueAt, now),
        not(
          and(
            isNotNull(reviewRequests.snoozeKind),
            or(isNull(reviewRequests.snoozedUntil), gt(reviewRequests.snoozedUntil, now)),
          ) ?? sql`false`,
        ),
        notExists(told),
      ),
    )
    .orderBy(asc(reviewRequests.dueAt), asc(reviewRequests.id))
    .for('update', { skipLocked: true })
}

/** An open request of a build in `teamId`; undefined when unknown, closed or in another team. */
export async function findOpenReviewRequest(
  db: Database,
  input: { teamId: string; requestId: string },
): Promise<ReviewRequest | undefined> {
  const inTeam = db.select({ id: builds.id }).from(builds).where(eq(builds.teamId, input.teamId))
  const [row] = await db
    .select()
    .from(reviewRequests)
    .where(
      and(
        eq(reviewRequests.id, input.requestId),
        eq(reviewRequests.state, 'open'),
        inArray(reviewRequests.buildId, inTeam),
      ),
    )
  return row
}

/**
 * When the reviewer was last told to review the build (asked, asked again or nudged); undefined
 * when never. Lets a nudge wait its turn.
 */
export async function lastReviewNoticeAt(
  db: Database,
  input: { reviewerId: string; buildId: string },
): Promise<Date | undefined> {
  const [row] = await db
    .select({ at: sql<Date | null>`max(${notifications.createdAt})` })
    .from(notifications)
    .where(
      and(
        eq(notifications.userId, input.reviewerId),
        eq(notifications.buildId, input.buildId),
        inArray(notifications.kind, ['review_requested', 'review_re_requested']),
      ),
    )
  return row?.at ? new Date(row.at) : undefined
}

/** One request by ID, open or closed; undefined when there is none. */
export async function findReviewRequest(
  db: Database,
  id: string,
): Promise<ReviewRequest | undefined> {
  const [row] = await db.select().from(reviewRequests).where(eq(reviewRequests.id, id))
  return row
}

/**
 * Opens again the requests of `ids` that a decision closed as `done` (the decision was undone),
 * except where the reviewer has been asked afresh since. Returns the ones it opened.
 */
export async function reopenReviewRequests(db: Database, ids: string[]): Promise<ReviewRequest[]> {
  if (ids.length === 0) return []
  return db
    .update(reviewRequests)
    .set({ state: 'open', closedAt: null })
    .where(
      and(
        inArray(reviewRequests.id, ids),
        eq(reviewRequests.state, 'done'),
        sql`not exists (
          select 1 from review_requests o
          where o.build_id = ${reviewRequests.buildId}
            and o.reviewer_id = ${reviewRequests.reviewerId}
            and o.state = 'open'
        )`,
      ),
    )
    .returning()
}

/** Puts a request's snooze back to what it was (`kind: null` for not snoozed). */
export async function restoreReviewRequestSnooze(
  db: Database,
  input: { id: string; kind: SnoozeKind | null; until: Date | null },
): Promise<void> {
  await db
    .update(reviewRequests)
    .set({ snoozeKind: input.kind, snoozedUntil: input.until })
    .where(eq(reviewRequests.id, input.id))
}
