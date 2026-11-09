import { snoozeUntil, type SnoozeChoice, assertFound } from '@circi/core'
import { type Database, type Notification, NotFoundError } from '@circi/db'
import { getNotificationPreferences } from '@circi/db/queries'
import { enqueueJob, QUEUES } from '@circi/db/queue'
import {
  createNotification,
  deleteNotification,
  emailPreferenceFor,
  markAllNotificationsRead,
  setNotificationPreferences,
  setNotificationRead,
  snoozeNotification as snoozeRow,
} from '@circi/db/repositories'

/**
 * Inbox notifications. `notify` is called by the services that change something, inside their
 * transaction, so the notification (and the email job it implies) exists exactly when the change
 * does. The rest is what a person does with their own inbox.
 */

/**
 * Tells `userId` about something. Does nothing when the person caused it themselves. For the
 * kinds that are also emailed (review requested, re-requested, overdue), queues an email job
 * unless the person turned that email off; the worker sends it only when the instance has SMTP.
 * Returns the notification, or undefined when none was made.
 */
export async function notify(db: Database, input: notify.Input): Promise<Notification | undefined> {
  if (input.actorId && input.actorId === input.userId) return undefined
  const notification = await createNotification(db, input)
  const preference = emailPreferenceFor(input.kind)
  if (preference && (await getNotificationPreferences(db, input.userId))[preference]) {
    await enqueueJob(db, {
      queue: QUEUES.notificationEmail,
      payload: { notificationId: notification.id },
      dedupeKey: `notification-email:${notification.id}`,
    })
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
  const row = await setNotificationRead(db, input)
  assertFound(row, 'Notification not found')
  return row
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
  const row = await snoozeRow(db, { userId: input.userId, id: input.id, until })
  assertFound(row, 'Notification not found')
  return row
}

/** Brings a snoozed notification back to the inbox now. */
export async function unsnoozeNotification(
  db: Database,
  input: { userId: string; id: string },
): Promise<Notification> {
  const row = await snoozeRow(db, { ...input, until: null })
  assertFound(row, 'Notification not found')
  return row
}

/** Deletes a notification from the user's inbox. */
export async function removeNotification(
  db: Database,
  input: { userId: string; id: string },
): Promise<void> {
  if (!(await deleteNotification(db, input))) throw new NotFoundError('Notification not found')
}

/** Marks the user's whole inbox read; returns how many it changed. */
export async function markInboxRead(db: Database, userId: string): Promise<number> {
  return markAllNotificationsRead(db, { userId })
}

/** Turns the email for a kind of notification on or off for the user. */
export async function updateNotificationPreferences(
  db: Database,
  userId: string,
  changes: Parameters<typeof setNotificationPreferences>[2],
) {
  return setNotificationPreferences(db, userId, changes)
}
