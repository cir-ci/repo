import { ConflictError, ForbiddenError, NotFoundError } from '@circi/core'
import type { Database } from '@circi/db'
import { lockUndoAction, markUndoUsed, type UndoAction } from '@circi/db/repositories'

import { type NoticeUndo, undoNotice } from '#src/notifications/undo.ts'
import {
  type BuildReviewUndo,
  type RequestReviewUndo,
  type RequestSnoozeUndo,
  undoBuildReview,
  undoRequestReview,
  undoRequestSnooze,
} from '#src/reviews/undo.ts'
import { type TriageUndo, undoTriage } from '#src/triage/undo.ts'

/**
 * The data an action recorded for its own undo (written by the same kind's service, so its shape
 * is known here by `kind`).
 */
// oxlint-disable-next-line typescript/no-unnecessary-type-parameters -- the caller names the kind's shape
function recorded<T>(data: unknown): T {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the row's kind says who wrote it
  return data as T
}

/**
 * Takes back an action the person did a moment ago: approving or rejecting, assigning, snoozing
 * or dismissing, reading, removing, asking for a review. `id` is the token the action returned.
 *
 * - Only the person who did it (`ForbiddenError` otherwise).
 * - Scoped like the action: a project's actions through that project (`projectId`), the inbox's with no
 *   project; anything else is "not found".
 * - Once (`ConflictError` when it was already undone), and only while the token lasts
 *   (`UNDO_WINDOW_MS`, `ConflictError` after).
 * - Only while nothing newer changed the same thing (`ConflictError`, and the message says so).
 *
 * One transaction: the change, the follow-ups (check runs, webhooks, notices) and the mark that
 * the token is used all commit together. Returns what was undone, so the caller can say so.
 */
export async function undoAction(
  db: Database,
  input: { id: string; userId: string; projectId: string | null; now?: Date },
): Promise<{ kind: UndoAction['kind'] }> {
  const now = input.now ?? new Date()
  return db.transaction(async (tx) => {
    const row = await lockUndoAction(tx, input.id)
    if (!row || row.projectId !== input.projectId) throw new NotFoundError('Nothing to undo')
    if (row.userId !== input.userId) throw new ForbiddenError('Only the person who did it can undo')
    if (row.usedAt) throw new ConflictError('Already undone')
    if (row.expiresAt.getTime() < now.getTime()) {
      throw new ConflictError("It's too late to undo that")
    }
    const data = row.data
    const projectId = row.projectId ?? ''
    switch (row.kind) {
      case 'build_review':
        await undoBuildReview(tx, recorded<BuildReviewUndo>(data))
        break
      case 'request_snooze':
        await undoRequestSnooze(tx, recorded<RequestSnoozeUndo>(data))
        break
      case 'request_review':
        await undoRequestReview(tx, recorded<RequestReviewUndo>(data), {
          projectId,
          userId: row.userId,
        })
        break
      case 'triage_assign':
      case 'triage_snooze':
      case 'triage_dismiss':
        await undoTriage(tx, recorded<TriageUndo>(data), projectId)
        break
      case 'notice_read':
      case 'notice_snooze':
      case 'notice_remove':
        await undoNotice(tx, recorded<NoticeUndo>(data), row.userId)
        break
    }
    await markUndoUsed(tx, row.id, now)
    return { kind: row.kind }
  })
}
