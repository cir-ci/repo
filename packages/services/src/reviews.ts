import { reviewDueAt, type SnoozeChoice, snoozeUntil, ValidationError } from '@circi/core'
import {
  type Build,
  buildsInDeletedWorkspaces,
  closeReviewRequestsForBuild,
  type Database,
  dismissReviewRequest as dismissRequest,
  getBuild,
  getTeamById,
  lockOverdueUnnotifiedRequests,
  hasClosedReviewRequest,
  markBuildNotificationsRead,
  listTeamBuildsByIds,
  NotFoundError,
  openReviewRequest,
  queueGitNotify,
  queueWebhookEvent,
  type recordReview,
  recordSnapshotReviews,
  type ReviewRequest,
  setReviewRequestSnooze,
} from '@circi/db'

import { gitKinds } from './git-kinds.ts'
import { queueIntegrationEvent } from './integration-events.ts'
import { notify } from './notifications.ts'

/**
 * Approves or rejects snapshots of a build, in one transaction. A decision is stored per
 * snapshot and the build's review status is derived from them (all changed snapshots approved:
 * approved; any rejected: rejected; otherwise still pending). Webhooks, the git host check, the
 * author's inbox and chat events follow only when that derived status actually moves, exactly
 * once, in the same transaction (the outbox). Deciding what was already decided is a no-op.
 * Whoever was asked to review the build no longer needs to once it is decided: its open review
 * requests close as done.
 */
export async function reviewSnapshots(db: Database, input: reviewSnapshots.Input): Promise<Build> {
  return db.transaction(async (tx) => {
    const { reason, userId, ...decision } = input
    const { build, changed, reasons, reviewerName } = await recordSnapshotReviews(tx, {
      ...decision,
      userId,
      ...(reason ? { reason } : {}),
    })
    if (build.reviewStatus !== 'pending') {
      const closed = await closeReviewRequestsForBuild(tx, build.id)
      // Deciding settles the build for its reviewer; the others' "please review" notices end
      // with their requests.
      await markBuildNotificationsRead(tx, { userId, buildId: build.id })
      for (const request of closed) {
        if (request.reviewerId === userId) continue
        // eslint-disable-next-line no-await-in-loop -- a few reviewers, one transaction
        await markBuildNotificationsRead(tx, {
          userId: request.reviewerId,
          buildId: build.id,
          kinds: REQUEST_KINDS,
        })
      }
    }
    if (!changed) return build
    if (build.reviewStatus !== 'pending') {
      const state = build.reviewStatus
      const rejectionReason = state === 'rejected' && reasons.length > 0 ? reasons.join('\n') : null
      if (build.authorUserId) {
        await notify(tx, {
          userId: build.authorUserId,
          kind: state === 'approved' ? 'build_approved' : 'build_rejected',
          buildId: build.id,
          actorId: userId,
          payload: rejectionReason ? { reason: rejectionReason } : {},
        })
      }
      await queueIntegrationEvent(tx, {
        type: state === 'approved' ? 'build.approved' : 'build.rejected',
        buildId: build.id,
        reviewerId: userId,
        reason: rejectionReason,
      })
      await queueWebhookEvent(tx, {
        build,
        event: 'build.reviewed',
        review: { state, source: input.source ?? 'ui', userName: reviewerName },
      })
    }
    // The check on the pull request follows every move, including back to "needs review".
    await queueGitNotify(tx, build, gitKinds())
    return build
  })
}
export namespace reviewSnapshots {
  export interface Input {
    buildId: string
    userId: string
    decision: recordSnapshotReviews.Input['decision']
    /** Names to decide; `all` decides every changed snapshot, `undecided` those with no decision. */
    snapshotNames: recordSnapshotReviews.Input['snapshotNames']
    source?: recordSnapshotReviews.Input['source']
    /** Why the snapshots were rejected; goes to the build's author once the build is rejected. */
    reason?: string | null
  }
}

/**
 * Approves or rejects every changed snapshot of a build: `reviewSnapshots` for all of them,
 * replacing earlier decisions.
 */
export async function reviewBuild(db: Database, input: reviewBuild.Input): Promise<Build> {
  const { state, ...rest } = input
  return reviewSnapshots(db, { ...rest, decision: state, snapshotNames: 'all' })
}
export namespace reviewBuild {
  export interface Input {
    buildId: string
    userId: string
    state: recordReview.Input['state']
    source?: recordReview.Input['source']
    /** Why the changes were rejected; goes to the build's author in their inbox. */
    reason?: string | null
  }
}

/** The notification kinds that ask someone to review; they end when the request does. */
const REQUEST_KINDS = ['review_requested', 'review_re_requested', 'review_overdue'] as const

/**
 * Asks `reviewerId` to review a build. The request is due when the team's review target runs
 * out (never, for a team without one). Asking again while the request is open returns it
 * unchanged; asking after it closed opens a new one.
 */
export async function requestReview(
  db: Database,
  input: requestReview.Input,
): Promise<requestReview.Result> {
  return db.transaction(async (tx) => {
    const build = await getBuild(tx, input.buildId)
    const team = build ? await getTeamById(tx, build.teamId) : undefined
    if (!build || !team) throw new NotFoundError('Build not found')
    const result = await openReviewRequest(tx, {
      buildId: build.id,
      reviewerId: input.reviewerId,
      requestedById: input.requestedById,
      dueAt: reviewDueAt(input.now ?? new Date(), team.reviewTargetHours),
    })
    if (result.created) await notifyReviewRequested(tx, result.request, input.requestedById)
    return result
  })
}
export namespace requestReview {
  export interface Input {
    buildId: string
    reviewerId: string
    requestedById: string
    /** For tests; defaults to the current time. */
    now?: Date
  }
  export type Result = openReviewRequest.Result
}

/** Most builds, and most reviewers, one bulk request may cover. */
export const MAX_BULK_REQUEST_REVIEW = 50
const MAX_REQUEST_REVIEWERS = 20

/**
 * Asks each of `reviewerIds` to review each of `buildIds`, all builds of one team, in a single
 * transaction: every pair goes through `requestReview` (so each new request notifies its
 * reviewer), and if any id is not a build of the team, or any pair cannot be asked (a build
 * that cannot be reviewed, a reviewer outside the workspace), nothing changes at all. A pair
 * that already has an open request keeps it and is reported as not created.
 */
export async function requestReviews(
  db: Database,
  input: requestReviews.Input,
): Promise<requestReviews.Result> {
  const buildIds = [...new Set(input.buildIds)]
  const reviewerIds = [...new Set(input.reviewerIds)]
  if (buildIds.length === 0) throw new ValidationError('buildIds: pick at least one build')
  if (buildIds.length > MAX_BULK_REQUEST_REVIEW) {
    throw new ValidationError(`buildIds: at most ${MAX_BULK_REQUEST_REVIEW} builds at once`)
  }
  if (reviewerIds.length === 0) throw new ValidationError('reviewerIds: pick at least one reviewer')
  if (reviewerIds.length > MAX_REQUEST_REVIEWERS) {
    throw new ValidationError(`reviewerIds: at most ${MAX_REQUEST_REVIEWERS} reviewers`)
  }
  return db.transaction(async (tx) => {
    const own = await listTeamBuildsByIds(tx, input.teamId, buildIds)
    if (own.length !== buildIds.length) throw new NotFoundError('Build not found')
    const requests: requestReviews.Item[] = []
    for (const buildId of buildIds) {
      for (const reviewerId of reviewerIds) {
        // Sequential on purpose: one transaction, one connection.
        // eslint-disable-next-line no-await-in-loop
        const { request, created } = await requestReview(tx, {
          buildId,
          reviewerId,
          requestedById: input.requestedById,
          ...(input.now ? { now: input.now } : {}),
        })
        requests.push({ buildId, reviewerId, request, created })
      }
    }
    return { requests }
  })
}
export namespace requestReviews {
  export interface Input {
    teamId: string
    buildIds: string[]
    reviewerIds: string[]
    requestedById: string
    /** For tests; defaults to the current time. */
    now?: Date
  }
  export interface Item {
    buildId: string
    reviewerId: string
    request: ReviewRequest
    /** False when the reviewer already had an open request for the build. */
    created: boolean
  }
  export interface Result {
    requests: Item[]
  }
}

/**
 * Drops a review request of a build in `teamId`. Only its reviewer or whoever asked may;
 * returns the request, or undefined when there was nothing of theirs to drop.
 */
export async function dismissReviewRequest(
  db: Database,
  input: { teamId: string; requestId: string; userId: string },
): Promise<ReviewRequest | undefined> {
  return db.transaction(async (tx) => {
    const dismissed = await dismissRequest(tx, input)
    if (dismissed) {
      await markBuildNotificationsRead(tx, {
        userId: dismissed.reviewerId,
        buildId: dismissed.buildId,
        kinds: REQUEST_KINDS,
      })
    }
    return dismissed
  })
}

/**
 * Tells a reviewer they were asked. It is a re-request when they had a request for this build
 * before that has since closed. `actorId` is null when the system asked (a rule or the rotation).
 */
export async function notifyReviewRequested(
  db: Database,
  request: ReviewRequest,
  actorId: string | null,
): Promise<void> {
  const again = await hasClosedReviewRequest(db, {
    buildId: request.buildId,
    reviewerId: request.reviewerId,
    exceptId: request.id,
  })
  await notify(db, {
    userId: request.reviewerId,
    kind: again ? 'review_re_requested' : 'review_requested',
    buildId: request.buildId,
    actorId,
    payload: request.dueAt ? { dueAt: request.dueAt.toISOString() } : {},
  })
  // A person asking themselves is not news for the channel.
  if (actorId !== request.reviewerId) {
    await queueIntegrationEvent(db, {
      type: 'review.requested',
      buildId: request.buildId,
      reviewerId: request.reviewerId,
      actorId,
      requestId: request.id,
      dueAt: request.dueAt?.toISOString() ?? null,
      again,
    })
  }
}

/** Most builds one bulk decision may cover. */
export const MAX_BULK_REVIEW = 50

/**
 * Approves or rejects several builds of one team at once, in a single transaction: every
 * build goes through `reviewBuild` (so each one that changed queues its own webhook and git
 * notices, and each one's review requests close), and if any id is not a build of the team, or
 * any build cannot be reviewed, nothing changes at all. `reason` is stored with a rejection
 * and goes to each build's author.
 */
export async function reviewBuilds(
  db: Database,
  input: reviewBuilds.Input,
): Promise<reviewBuilds.Result> {
  const ids = [...new Set(input.buildIds)]
  if (ids.length === 0) throw new ValidationError('buildIds: pick at least one build')
  if (ids.length > MAX_BULK_REVIEW) {
    throw new ValidationError(`buildIds: at most ${MAX_BULK_REVIEW} builds at once`)
  }
  return db.transaction(async (tx) => {
    const own = await listTeamBuildsByIds(tx, input.teamId, ids)
    if (own.length !== ids.length) throw new NotFoundError('Build not found')
    const reviewed: Build[] = []
    for (const id of ids) {
      // Sequential on purpose: one transaction, one connection.
      // eslint-disable-next-line no-await-in-loop
      const build = await reviewBuild(tx, {
        buildId: id,
        userId: input.userId,
        state: input.state,
        ...(input.source ? { source: input.source } : {}),
        ...(input.reason ? { reason: input.reason } : {}),
      })
      reviewed.push(build)
    }
    return { builds: reviewed }
  })
}
export namespace reviewBuilds {
  export interface Input {
    teamId: string
    buildIds: string[]
    userId: string
    state: reviewBuild.Input['state']
    source?: reviewBuild.Input['source']
    reason?: string
  }
  export interface Result {
    builds: Build[]
  }
}

/**
 * Puts an open request of yours off. `next_push` lasts until a newer build on the branch
 * (finalizing it supersedes the request, which ends the snooze with it); the other choices end at
 * a time (`date` is the end for `choice: 'date'`). Overdue reminders pause while it lasts.
 * Throws NotFoundError when the request is not an open one of yours in the team.
 */
export async function snoozeReviewRequest(
  db: Database,
  input: {
    teamId: string
    requestId: string
    userId: string
    kind: SnoozeChoice
    date?: Date | null
    now?: Date
  },
): Promise<ReviewRequest> {
  const until = snoozeUntil(input.kind, input.now ?? new Date(), input.date)
  const row = await setReviewRequestSnooze(db, {
    teamId: input.teamId,
    requestId: input.requestId,
    userId: input.userId,
    kind: input.kind,
    until,
  })
  if (!row) throw new NotFoundError('Review request not found')
  return row
}

/** Brings a snoozed request back to For you now. */
export async function unsnoozeReviewRequest(
  db: Database,
  input: { teamId: string; requestId: string; userId: string },
): Promise<ReviewRequest> {
  const row = await setReviewRequestSnooze(db, { ...input, kind: null, until: null })
  if (!row) throw new NotFoundError('Review request not found')
  return row
}

/**
 * Tells reviewers their request is overdue: once per request, ever. A request qualifies when it
 * is open, past `due_at`, not snoozed, and no `review_overdue` notification for it exists yet
 * (the notification's `requestId` is the memory, so a deleted or read notice is not re-sent).
 * Returns how many reviewers were told.
 */
export async function notifyOverdueReviews(
  db: Database,
  input: { now?: Date } = {},
): Promise<number> {
  const now = input.now ?? new Date()
  return db.transaction(async (tx) => {
    const locked = await lockOverdueUnnotifiedRequests(tx, now)
    // A deleted workspace's requests stay quiet (and un-notified, so a restore tells them).
    const hidden = await buildsInDeletedWorkspaces(
      tx,
      locked.map((r) => r.buildId),
    )
    const requests = locked.filter((r) => !hidden.has(r.buildId))
    for (const request of requests) {
      // eslint-disable-next-line no-await-in-loop -- one transaction, one connection
      await notify(tx, {
        userId: request.reviewerId,
        kind: 'review_overdue',
        buildId: request.buildId,
        actorId: null,
        payload: {
          requestId: request.id,
          dueAt: request.dueAt?.toISOString() ?? null,
          overdueByMs: request.dueAt ? now.getTime() - request.dueAt.getTime() : 0,
        },
      })
      // eslint-disable-next-line no-await-in-loop -- one transaction, one connection
      await queueIntegrationEvent(tx, {
        type: 'review.overdue',
        buildId: request.buildId,
        reviewerId: request.reviewerId,
        requestId: request.id,
        dueAt: request.dueAt?.toISOString() ?? null,
      })
    }
    return requests.length
  })
}
