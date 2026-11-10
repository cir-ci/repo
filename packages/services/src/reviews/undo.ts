import { ConflictError } from '@circi/core'
import type { Database } from '@circi/db'
import { queueGitNotify, queueWebhookEvent } from '@circi/db/queue'
import {
  deleteNotificationsById,
  dismissReviewRequest as dismissRequest,
  findReviewRequest,
  reopenReviewRequests,
  restoreReviewRequestSnooze,
  restoreSnapshotReviews,
} from '@circi/db/repositories'
import { integrationRegistry } from '@circi/integrations'

/**
 * Taking back what a person did to a build's review (the Undo on the toast). Each function runs in
 * `undoAction`'s transaction and throws `ConflictError` when something newer changed the same thing
 * since, so a stale undo never overwrites a later decision. The decision rows stay as history: the
 * undone ones are superseded, the ones they had superseded are current again.
 */

/** What `reviewSnapshotsUndoable` records: the rows it wrote and put into history, and what followed. */
export interface BuildReviewUndo {
  buildId: string
  decision: 'approved' | 'rejected'
  /** The snapshots whose decision changed (shown in the build's activity). */
  names: string[]
  insertedIds: string[]
  supersededIds: string[]
  previousStatus: 'pending' | 'approved' | 'rejected'
  resultStatus: 'pending' | 'approved' | 'rejected'
  /** The review requests the decision closed, and the notices it made for others. */
  closedRequestIds: string[]
  noticeIds: string[]
}

const STALE = "Someone changed this review since, so it can't be undone"

export async function undoBuildReview(tx: Database, data: BuildReviewUndo): Promise<void> {
  const { stale, build, changed } = await restoreSnapshotReviews(tx, data)
  if (stale) throw new ConflictError(STALE)
  await reopenReviewRequests(tx, data.closedRequestIds)
  await deleteNotificationsById(tx, data.noticeIds)
  // The check run, and any webhook, follow the undo as they followed the decision.
  if (changed) {
    await queueWebhookEvent(tx, {
      build,
      event: 'build.reviewed',
      ...(build.reviewStatus === 'pending'
        ? {}
        : { review: { state: build.reviewStatus, source: 'ui', userName: null } }),
    })
    await queueGitNotify(tx, build, integrationRegistry.gitKinds())
  } else if (data.names.length > 0) {
    await queueGitNotify(tx, build, integrationRegistry.gitKinds(), `snapshots:${Date.now()}`)
  }
}

/** What `snoozeReviewRequestUndoable` records. */
export interface RequestSnoozeUndo {
  requestId: string
  previous: { kind: 'next_push' | 'tomorrow' | 'next_week' | 'date' | null; until: string | null }
  after: { kind: 'next_push' | 'tomorrow' | 'next_week' | 'date' | null; until: string | null }
}

export async function undoRequestSnooze(tx: Database, data: RequestSnoozeUndo): Promise<void> {
  const row = await findReviewRequest(tx, data.requestId)
  const same =
    row?.state === 'open' &&
    row.snoozeKind === data.after.kind &&
    (row.snoozedUntil?.toISOString() ?? null) === data.after.until
  if (!same) throw new ConflictError("The request changed since, so it can't be undone")
  await restoreReviewRequestSnooze(tx, {
    id: data.requestId,
    kind: data.previous.kind,
    until: data.previous.until ? new Date(data.previous.until) : null,
  })
}

/** What `requestReviewsUndoable` records: the requests it opened and the notices it sent. */
export interface RequestReviewUndo {
  requestIds: string[]
  noticeIds: string[]
}

export async function undoRequestReview(
  tx: Database,
  data: RequestReviewUndo,
  who: { teamId: string; userId: string },
): Promise<void> {
  for (const requestId of data.requestIds) {
    // eslint-disable-next-line no-await-in-loop -- one transaction, one connection
    const dropped = await dismissRequest(tx, { ...who, requestId })
    if (!dropped) throw new ConflictError("A reviewer already answered, so it can't be undone")
  }
  await deleteNotificationsById(tx, data.noticeIds)
}
