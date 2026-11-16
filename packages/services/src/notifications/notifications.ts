import { snoozeUntil, type SnoozeChoice, assertFound } from '@circi/core'
import { type Database, type Notification, NotFoundError } from '@circi/db'
import { getNotificationPreferences } from '@circi/db/queries'
import { enqueueJob, QUEUES } from '@circi/db/queue'
import {
  createNotification,
  deleteNotification,
  emailPreferenceFor,
  hasPushSubscription,
  markAllNotificationsRead,
  pushPreferenceFor,
  setNotificationPreferences,
  setNotificationRead,
  snoozeNotification as snoozeRow,
} from '@circi/db/repositories'

import { emitUserLive } from '#src/live/index.ts'
import { type UndoToken } from '#src/undo/record.ts'

import { withNoticeUndo } from './undo.ts'

/**
 * Inbox notifications. `notify` is called by the services that change something, inside their
 * transaction, so the notification (and the email job it implies) exists exactly when the change
 * does. The rest is what a person does with their own inbox.
 */

/**
 * Tells `userId` about something. Does nothing when the person caused it themselves. Queues one
 * delivery job when the notification is also sent beyond the inbox: an email for the kinds that
 * are emailed (review requested, re-requested, overdue) unless the person turned it off, and a web
 * push for the kinds that are pushed when they turned that kind on and have a device that takes
 * it. The worker re-checks both, and sends the email only when the instance has SMTP.
 * Returns the notification, or undefined when none was made.
 */
export async function notify(db: Database, input: notify.Input): Promise<Notification | undefined> {
  if (input.actorId && input.actorId === input.userId) return undefined
  const notification = await createNotification(db, input)
  await emitUserLive(db, 'notification.created', input.userId)
  const emailPreference = emailPreferenceFor(input.kind)
  const pushPreference = pushPreferenceFor(input.kind)
  if (emailPreference || pushPreference) {
    const preferences = await getNotificationPreferences(db, input.userId)
    const email = emailPreference !== undefined && preferences[emailPreference]
    const push =
      pushPreference !== undefined &&
      preferences[pushPreference] &&
      (await hasPushSubscription(db, input.userId))
    if (email || push) {
      await enqueueJob(db, {
        // The queue kept its name from when it only sent email; see `deliverNotification`.
        queue: QUEUES.notificationEmail,
        payload: { notificationId: notification.id },
        dedupeKey: `notification-email:${notification.id}`,
      })
    }
  }
  return notification
}
export namespace notify {
  export type Input = createNotification.Input
}

/** Marks a notification read or unread; it must be the user's own. */
export async function markNotificationRead(
  db: Database,
  input: { userId: string; id: string; read: boolean },
): Promise<Notification> {
  return db.transaction(async (tx) => {
    const row = await setNotificationRead(tx, input)
    assertFound(row, 'Notification not found')
    await emitUserLive(tx, 'notification.read', input.userId)
    return row
  })
}

/**
 * Hides a notification until the snooze ends. Notifications wake at a time (`tomorrow`,
 * `next_week`, `date`); "until next push" belongs to review requests, not to notifications.
 */
export async function snoozeNotification(
  db: Database,
  input: {
    userId: string
    id: string
    choice: Exclude<SnoozeChoice, 'next_push'>
    date?: Date | null
    now?: Date
  },
): Promise<Notification> {
  const until = snoozeUntil(input.choice, input.now ?? new Date(), input.date)
  return db.transaction(async (tx) => {
    const row = await snoozeRow(tx, { userId: input.userId, id: input.id, until })
    assertFound(row, 'Notification not found')
    await emitUserLive(tx, 'notification.read', input.userId)
    return row
  })
}

/** The inbox actions below, for a person at the dashboard: the same change, with a token that takes it back. */
export async function markNotificationReadUndoable(
  db: Database,
  input: Parameters<typeof markNotificationRead>[1],
): Promise<{ notification: Notification; undo: UndoToken | null }> {
  const { result, undo } = await withNoticeUndo(db, {
    userId: input.userId,
    id: input.id,
    kind: 'notice_read',
    field: 'readAt',
    change: (tx) => markNotificationRead(tx, input),
  })
  return { notification: result, undo }
}

export async function snoozeNotificationUndoable(
  db: Database,
  input: Parameters<typeof snoozeNotification>[1],
): Promise<{ notification: Notification; undo: UndoToken | null }> {
  const { result, undo } = await withNoticeUndo(db, {
    userId: input.userId,
    id: input.id,
    kind: 'notice_snooze',
    field: 'snoozedUntil',
    change: (tx) => snoozeNotification(tx, input),
  })
  return { notification: result, undo }
}

export async function removeNotificationUndoable(
  db: Database,
  input: { userId: string; id: string },
): Promise<{ undo: UndoToken | null }> {
  const { undo } = await withNoticeUndo(db, {
    userId: input.userId,
    id: input.id,
    kind: 'notice_remove',
    field: 'deletedAt',
    change: (tx) => removeNotification(tx, input),
  })
  return { undo }
}

/** Brings a snoozed notification back to the inbox now. */
export async function unsnoozeNotification(
  db: Database,
  input: { userId: string; id: string },
): Promise<Notification> {
  return db.transaction(async (tx) => {
    const row = await snoozeRow(tx, { ...input, until: null })
    assertFound(row, 'Notification not found')
    await emitUserLive(tx, 'notification.read', input.userId)
    return row
  })
}

/** `unsnoozeNotification` with a token that snoozes it again to the same time; none when it wasn't snoozed. */
export async function unsnoozeNotificationUndoable(
  db: Database,
  input: Parameters<typeof unsnoozeNotification>[1],
): Promise<{ notification: Notification; undo: UndoToken | null }> {
  const { result, undo } = await withNoticeUndo(db, {
    userId: input.userId,
    id: input.id,
    kind: 'notice_snooze',
    field: 'snoozedUntil',
    change: (tx) => unsnoozeNotification(tx, input),
  })
  return { notification: result, undo }
}

/** Deletes a notification from the user's inbox. */
export async function removeNotification(
  db: Database,
  input: { userId: string; id: string },
): Promise<void> {
  await db.transaction(async (tx) => {
    if (!(await deleteNotification(tx, input))) throw new NotFoundError('Notification not found')
    await emitUserLive(tx, 'notification.read', input.userId)
  })
}

/** Marks the user's whole inbox read; returns how many it changed. */
export async function markInboxRead(db: Database, userId: string): Promise<number> {
  return db.transaction(async (tx) => {
    const changed = await markAllNotificationsRead(tx, { userId })
    if (changed > 0) await emitUserLive(tx, 'notification.read', userId)
    return changed
  })
}

/** Turns the email for a kind of notification on or off for the user. */
export async function updateNotificationPreferences(
  db: Database,
  userId: string,
  changes: Parameters<typeof setNotificationPreferences>[2],
) {
  return setNotificationPreferences(db, userId, changes)
}
