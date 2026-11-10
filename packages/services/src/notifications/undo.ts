import { ConflictError } from '@circi/core'
import { type Database, NotFoundError } from '@circi/db'
import {
  getNotificationFields,
  type NotificationFields,
  restoreNotificationFields,
} from '@circi/db/repositories'

import { type UndoToken, recordUndo } from '#src/undo/record.ts'

/**
 * Taking back what a person did to one of their notices: read or unread, snoozed, removed. The
 * field the action touched is written down before and after; an undo applies only while it still
 * holds what the action set.
 */

type Field = keyof NotificationFields

export interface NoticeUndo {
  id: string
  field: Field
  previous: string | null
  after: string | null
}

const iso = (d: Date | null) => d?.toISOString() ?? null

/**
 * Runs `change` (an inbox action on `id`) and records how it moved `field`. Returns the token, or
 * null when the field did not move. The notice must be the person's own.
 */
export async function withNoticeUndo<T>(
  db: Database,
  input: {
    userId: string
    id: string
    kind: 'notice_read' | 'notice_snooze' | 'notice_remove'
    field: Field
    change: (tx: Database) => Promise<T>
  },
): Promise<{ result: T; undo: UndoToken | null }> {
  return db.transaction(async (tx) => {
    const before = await getNotificationFields(tx, input)
    if (!before) throw new NotFoundError('Notification not found')
    const result = await input.change(tx)
    const after = await getNotificationFields(tx, input)
    const previous = iso(before[input.field])
    const next = iso(after?.[input.field] ?? null)
    if (previous === next) return { result, undo: null }
    const data: NoticeUndo = { id: input.id, field: input.field, previous, after: next }
    const undo = await recordUndo(tx, {
      userId: input.userId,
      teamId: null,
      kind: input.kind,
      data,
    })
    return { result, undo }
  })
}

export async function undoNotice(tx: Database, data: NoticeUndo, userId: string): Promise<void> {
  const current = await getNotificationFields(tx, { userId, id: data.id })
  if (!current) throw new NotFoundError('Notification not found')
  if (iso(current[data.field]) !== data.after) {
    throw new ConflictError("The notice changed since, so it can't be undone")
  }
  await restoreNotificationFields(tx, {
    userId,
    id: data.id,
    ...current,
    [data.field]: data.previous ? new Date(data.previous) : null,
  })
}
