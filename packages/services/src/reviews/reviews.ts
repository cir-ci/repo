import {
  ConflictError,
  ForbiddenError,
  reviewDueAt,
  type SnoozeChoice,
  snoozeUntil,
  ValidationError,
  assertFound,
} from '@circi/core'
import {
  type Build,
  type Database,
  type Notification,
  NotFoundError,
  type ReviewRequest,
} from '@circi/db'
import { getBuild, getProjectById, listProjectBuildsByIds } from '@circi/db/queries'
import { queueGitNotify, queueWebhookEvent } from '@circi/db/queue'
import {
  buildsInDeletedWorkspaces,
  closeReviewRequestsForBuild,
  dismissReviewRequest as dismissRequest,
  lockOverdueUnnotifiedRequests,
  findOpenReviewRequest,
  hasClosedReviewRequest,
  lastReviewNoticeAt,
  markBuildNotificationsRead,
  openReviewRequest,
  type recordReview,
  recordSnapshotReviews,
  setReviewRequestSnooze,
} from '@circi/db/repositories'
import { integrationRegistry } from '@circi/integrations'

import { queueIntegrationEvent } from '#src/integration-admin/events.ts'
import { notify } from '#src/notifications/notifications.ts'
import { notifyFlakyDetected } from '#src/notifications/system-notices.ts'
import { type UndoToken, recordUndo } from '#src/undo/record.ts'

import type { BuildReviewUndo, RequestReviewUndo, RequestSnoozeUndo } from './undo.ts'

/**
 * Approves or rejects snapshots of a build, in one transaction. A decision is stored per
 * snapshot and the build's review status is derived from them (all changed snapshots approved:
 * approved; any rejected: rejected; otherwise still pending). Webhooks, the git host check, the
 * author's inbox and chat events follow only when that derived status actually moves, exactly
 * once, in the same transaction (the outbox). The pull request comment shows each snapshot's
 * decision, so a decision that doesn't move the status still refreshes it. Deciding what was
 * already decided is a no-op.
 * Whoever was asked to review the build no longer needs to once it is decided: its open review
 * requests close as done.
 */
export async function reviewSnapshots(db: Database, input: reviewSnapshots.Input): Promise<Build> {
  const { build } = await db.transaction((tx) => decideSnapshots(tx, input, undefined))
  return build
}

/**
 * `reviewSnapshots` for a person at the dashboard: the same decision, and with it a token to take
 * it back (`undoAction`) when it changed something. The record behind the token is written in the
 * same transaction, with what the decision did around the build (the review requests it closed,
 * the author's notice), so undoing puts those back too.
 */
export async function reviewSnapshotsUndoable(
  db: Database,
  input: reviewSnapshots.Input & { projectId: string },
): Promise<{ build: Build; undo: UndoToken | null }> {
  const { projectId, ...rest } = input
  return db.transaction((tx) => decideSnapshots(tx, rest, { projectId }))
}

async function decideSnapshots(
  tx: Database,
  input: reviewSnapshots.Input,
  undo: { projectId: string } | undefined,
): Promise<{ build: Build; undo: UndoToken | null }> {
  const { reason, userId, ...decision } = input
  await assertRejectReason(tx, input)
  const addedFlaky: string[] = []
  const recorded = await recordSnapshotReviews(
    tx,
    { ...decision, userId, ...(reason ? { reason } : {}) },
    addedFlaky,
  )
  const { build, changed, decided, reasons, reviewerName } = recorded
  await notifyFlakyDetected(tx, {
    projectId: build.projectId,
    buildId: build.id,
    names: addedFlaky,
  })
  const closedRequestIds: string[] = []
  const noticeIds: string[] = []
  if (build.reviewStatus !== 'pending') {
    const closed = await closeReviewRequestsForBuild(tx, build.id)
    closedRequestIds.push(...closed.map((r) => r.id))
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
  if (changed && build.reviewStatus !== 'pending') {
    const state = build.reviewStatus
    const rejectionReason = state === 'rejected' && reasons.length > 0 ? reasons.join('\n') : null
    if (build.authorUserId) {
      const notice = await notify(tx, {
        userId: build.authorUserId,
        kind: state === 'approved' ? 'build_approved' : 'build_rejected',
        buildId: build.id,
        actorId: userId,
        payload: rejectionReason ? { reason: rejectionReason } : {},
      })
      if (notice) noticeIds.push(notice.id)
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
  if (changed) {
    // The check on the pull request follows every move, including back to "needs review".
    await queueGitNotify(tx, build, integrationRegistry.gitKinds())
  } else if (decided.length > 0) {
    // Some snapshots were decided but the build's status did not move: the comment on the
    // pull request still shows the per-snapshot counts, so it follows too.
    await queueGitNotify(tx, build, integrationRegistry.gitKinds(), `snapshots:${Date.now()}`)
  }
  const worthUndoing = changed || decided.length > 0 || recorded.reviewId !== null
  if (!undo || !worthUndoing) return { build, undo: null }
  const data: BuildReviewUndo = {
    buildId: build.id,
    decision: input.decision,
    names: decided,
    insertedIds: recorded.insertedIds,
    supersededIds: recorded.supersededIds,
    previousStatus: recorded.previousStatus,
    resultStatus: build.reviewStatus,
    closedRequestIds,
    noticeIds,
  }
  return {
    build,
    undo: await recordUndo(tx, { userId, projectId: undo.projectId, kind: 'build_review', data }),
  }
}
/**
 * A project that asks for a reason when someone rejects refuses a rejection from the dashboard
 * (or the API) without one. A code host's approve and reject buttons and comment commands have
 * nowhere to write a reason, so they are exempt.
 */
async function assertRejectReason(db: Database, input: reviewSnapshots.Input): Promise<void> {
  if (input.decision !== 'rejected' || input.reason?.trim()) return
  if (input.source !== undefined && input.source !== 'ui') return
  const build = await getBuild(db, input.buildId)
  const project = build ? await getProjectById(db, build.projectId) : undefined
  if (project?.requireRejectReason) {
    throw new ValidationError('Add a reason for rejecting', {
      fields: { reason: 'Add a reason for rejecting' },
    })
  }
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

/** `reviewBuild` for a person at the dashboard, with a token to take the decision back. */
export async function reviewBuildUndoable(
  db: Database,
  input: reviewBuild.Input & { projectId: string },
): ReturnType<typeof reviewSnapshotsUndoable> {
  const { state, ...rest } = input
  return reviewSnapshotsUndoable(db, { ...rest, decision: state, snapshotNames: 'all' })
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
 * Asks `reviewerId` to review a build; asking yourself is refused. The request is due when the project's review target runs
 * out (never, for a project without one). Asking again while the request is open returns it
 * unchanged; asking after it closed opens a new one.
 */
export async function requestReview(
  db: Database,
  input: requestReview.Input,
): Promise<requestReview.Result> {
  if (input.reviewerId === input.requestedById) throw new ValidationError(SELF_REQUEST)
  return db.transaction(async (tx) => {
    const build = await getBuild(tx, input.buildId)
    const project = build ? await getProjectById(tx, build.projectId) : undefined
    if (!build || !project) throw new NotFoundError('Build not found')
    const result = await openReviewRequest(tx, {
      buildId: build.id,
      reviewerId: input.reviewerId,
      requestedById: input.requestedById,
      dueAt: reviewDueAt(input.now ?? new Date(), project.reviewTargetHours),
    })
    if (!result.created) return result
    const notice = await notifyReviewRequested(tx, result.request, input.requestedById)
    return notice ? { ...result, noticeId: notice.id } : result
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
  export type Result = openReviewRequest.Result & {
    /** The notice the reviewer got (not for yourself, which isn't news). */
    noticeId?: string
  }
}

const SELF_REQUEST = "You can't request a review from yourself."

/** Most builds, and most reviewers, one bulk request may cover. */
export const MAX_BULK_REQUEST_REVIEW = 50
const MAX_REQUEST_REVIEWERS = 20

/**
 * Asks each of `reviewerIds` to review each of `buildIds`, all builds of one project, in a single
 * transaction: every pair goes through `requestReview` (so each new request notifies its
 * reviewer), and if any id is not a build of the project, or any pair cannot be asked (a build
 * that cannot be reviewed, a reviewer outside the workspace), nothing changes at all. A pair
 * that already has an open request keeps it and is reported as not created.
 */
export async function requestReviews(
  db: Database,
  input: requestReviews.Input,
): Promise<requestReviews.Result> {
  const buildIds = [...new Set(input.buildIds)]
  const reviewerIds = [...new Set(input.reviewerIds)]
  if (buildIds.length === 0) throw new ValidationError('Pick at least one build')
  if (buildIds.length > MAX_BULK_REQUEST_REVIEW) {
    throw new ValidationError(`Pick at most ${MAX_BULK_REQUEST_REVIEW} builds at once`)
  }
  if (reviewerIds.length === 0) throw new ValidationError('Pick at least one reviewer')
  if (reviewerIds.length > MAX_REQUEST_REVIEWERS) {
    throw new ValidationError(`Pick at most ${MAX_REQUEST_REVIEWERS} reviewers`)
  }
  if (reviewerIds.includes(input.requestedById)) throw new ValidationError(SELF_REQUEST)
  return db.transaction(async (tx) => {
    const own = await listProjectBuildsByIds(tx, input.projectId, buildIds)
    if (own.length !== buildIds.length) throw new NotFoundError('Build not found')
    const requests: requestReviews.Item[] = []
    for (const buildId of buildIds) {
      for (const reviewerId of reviewerIds) {
        // Sequential on purpose: one transaction, one connection.
        // eslint-disable-next-line no-await-in-loop
        const { request, created, noticeId } = await requestReview(tx, {
          buildId,
          reviewerId,
          requestedById: input.requestedById,
          ...(input.now ? { now: input.now } : {}),
        })
        requests.push({ buildId, reviewerId, request, created, ...(noticeId ? { noticeId } : {}) })
      }
    }
    return { requests }
  })
}
export namespace requestReviews {
  export interface Input {
    projectId: string
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
    noticeId?: string
  }
  export interface Result {
    requests: Item[]
  }
}

/**
 * `requestReviews` for a person at the dashboard, with a token that cancels the requests it
 * opened (and takes back their notices). No token when every reviewer was already asked.
 */
export async function requestReviewsUndoable(
  db: Database,
  input: requestReviews.Input,
): Promise<requestReviews.Result & { undo: UndoToken | null }> {
  return db.transaction(async (tx) => {
    const result = await requestReviews(tx, input)
    const opened = result.requests.filter((r) => r.created)
    if (opened.length === 0) return { ...result, undo: null }
    const data: RequestReviewUndo = {
      requestIds: opened.map((r) => r.request.id),
      noticeIds: opened.flatMap((r) => (r.noticeId ? [r.noticeId] : [])),
    }
    const undo = await recordUndo(tx, {
      userId: input.requestedById,
      projectId: input.projectId,
      kind: 'request_review',
      data,
    })
    return { ...result, undo }
  })
}

/**
 * Drops a review request of a build in `projectId`. Only its reviewer or whoever asked may;
 * returns the request, or undefined when there was nothing of theirs to drop.
 */
export async function dismissReviewRequest(
  db: Database,
  input: { projectId: string; requestId: string; userId: string },
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

/** How long a reviewer is left alone after being asked or nudged. */
export const NUDGE_INTERVAL_MS = 24 * 3600_000

/**
 * Tells a reviewer again that a build waits for them. Only whoever asked may; at most once per
 * 24 hours (counting the ask itself), so a request can't be used to pester. The reviewer gets a
 * "review again" notice from the person; returns the request.
 */
export async function nudgeReviewRequest(
  db: Database,
  input: nudgeReviewRequest.Input,
): Promise<ReviewRequest> {
  return db.transaction(async (tx) => {
    const request = await findOpenReviewRequest(tx, input)
    if (!request) throw new NotFoundError('Review request not found')
    if (request.requestedById !== input.userId) {
      throw new ForbiddenError('Only whoever asked can nudge')
    }
    const now = input.now ?? new Date()
    const last = await lastReviewNoticeAt(tx, request)
    if (last && now.getTime() - last.getTime() < NUDGE_INTERVAL_MS) {
      throw new ConflictError('Already nudged in the last 24 hours')
    }
    await notify(tx, {
      userId: request.reviewerId,
      kind: 'review_re_requested',
      buildId: request.buildId,
      actorId: input.userId,
      payload: { nudge: true, requestId: request.id },
    })
    return request
  })
}
export namespace nudgeReviewRequest {
  export interface Input {
    projectId: string
    requestId: string
    userId: string
    /** For tests; defaults to the current time. */
    now?: Date
  }
}

/**
 * Tells a reviewer they were asked. It is a re-request when they had a request for this build
 * before that has since closed, or when the caller says so (`again`: the same reviewer was asked
 * about an older build of the branch). `actorId` is null when the system asked (a rule or the rotation).
 */
export async function notifyReviewRequested(
  db: Database,
  request: ReviewRequest,
  actorId: string | null,
  options: { again?: boolean } = {},
): Promise<Notification | undefined> {
  const again =
    options.again ??
    (await hasClosedReviewRequest(db, {
      buildId: request.buildId,
      reviewerId: request.reviewerId,
      exceptId: request.id,
    }))
  const notice = await notify(db, {
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
  return notice
}

/** Most builds one bulk decision may cover. */
export const MAX_BULK_REVIEW = 50

/**
 * Approves or rejects several builds of one project at once, in a single transaction: every
 * build goes through `reviewBuild` (so each one that changed queues its own webhook and git
 * notices, and each one's review requests close), and if any id is not a build of the project, or
 * any build cannot be reviewed, nothing changes at all. `reason` is stored with a rejection
 * and goes to each build's author.
 */
export async function reviewBuilds(
  db: Database,
  input: reviewBuilds.Input,
): Promise<reviewBuilds.Result> {
  const ids = [...new Set(input.buildIds)]
  if (ids.length === 0) throw new ValidationError('Pick at least one build')
  if (ids.length > MAX_BULK_REVIEW) {
    throw new ValidationError(`Pick at most ${MAX_BULK_REVIEW} builds at once`)
  }
  return db.transaction(async (tx) => {
    const own = await listProjectBuildsByIds(tx, input.projectId, ids)
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
    projectId: string
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
 * Throws NotFoundError when the request is not an open one of yours in the project.
 */
export async function snoozeReviewRequest(
  db: Database,
  input: {
    projectId: string
    requestId: string
    userId: string
    kind: SnoozeChoice
    date?: Date | null
    now?: Date
  },
): Promise<ReviewRequest> {
  const until = snoozeUntil(input.kind, input.now ?? new Date(), input.date)
  const row = await setReviewRequestSnooze(db, {
    projectId: input.projectId,
    requestId: input.requestId,
    userId: input.userId,
    kind: input.kind,
    until,
  })
  assertFound(row, 'Review request not found')
  return row
}

/**
 * `snoozeReviewRequest` with a token that puts the snooze back as it was (not snoozed, or the
 * earlier one).
 */
export async function snoozeReviewRequestUndoable(
  db: Database,
  input: Parameters<typeof snoozeReviewRequest>[1],
): Promise<{ request: ReviewRequest; undo: UndoToken }> {
  return db.transaction(async (tx) => {
    const before = await findOpenReviewRequest(tx, input)
    const request = await snoozeReviewRequest(tx, input)
    const data: RequestSnoozeUndo = {
      requestId: request.id,
      previous: {
        kind: before?.snoozeKind ?? null,
        until: before?.snoozedUntil?.toISOString() ?? null,
      },
      after: { kind: request.snoozeKind, until: request.snoozedUntil?.toISOString() ?? null },
    }
    const undo = await recordUndo(tx, {
      userId: input.userId,
      projectId: input.projectId,
      kind: 'request_snooze',
      data,
    })
    return { request, undo }
  })
}

/** Brings a snoozed request back to For you now. */
export async function unsnoozeReviewRequest(
  db: Database,
  input: { projectId: string; requestId: string; userId: string },
): Promise<ReviewRequest> {
  const row = await setReviewRequestSnooze(db, { ...input, kind: null, until: null })
  assertFound(row, 'Review request not found')
  return row
}

/**
 * Tells reviewers their request is overdue: once per request, ever. A request qualifies when it
 * is open, past `due_at`, not snoozed, and no `review_overdue` notification for it exists yet
 * (the notification's `requestId` is the memory, so a deleted or read notice is not re-sent).
 * The project's overdue contact, when it has one, is told too. Returns how many reviewers were told.
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
      // The project can name someone who is also told when a request misses its target.
      // eslint-disable-next-line no-await-in-loop -- one transaction, one connection
      const build = await getBuild(tx, request.buildId)
      // eslint-disable-next-line no-await-in-loop -- one transaction, one connection
      const project = build ? await getProjectById(tx, build.projectId) : undefined
      const ccId = project?.reviewOverdueNotifyUserId ?? null
      if (ccId && ccId !== request.reviewerId) {
        // eslint-disable-next-line no-await-in-loop -- one transaction, one connection
        await notify(tx, {
          userId: ccId,
          kind: 'review_overdue',
          buildId: request.buildId,
          actorId: request.reviewerId,
          payload: {
            requestId: request.id,
            cc: true,
            dueAt: request.dueAt?.toISOString() ?? null,
            overdueByMs: request.dueAt ? now.getTime() - request.dueAt.getTime() : 0,
          },
        })
      }
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
