import { and, eq, inArray, isNull, ne, sql } from 'drizzle-orm'

import { getNotificationPreferences } from '#queries/inbox.ts'
import {
  builds,
  type NotificationKind,
  notificationPreferences,
  notifications,
  workspace,
  projects,
  reviewRequests,
  user,
} from '#schema/index.ts'
import type { Database } from '#src/client.ts'
import type { Notification } from '#src/types.ts'

/**
 * Inbox notifications and who wants email about them. Data only: deciding that something
 * deserves a notification, and queueing the email, is `notify` in `@circi/services`. Every
 * function that acts on an existing notification is scoped to its `userId`, so nobody can touch
 * another person's inbox.
 */

/** The preference that controls the email for a kind; undefined for kinds that are not emailed. */
export function emailPreferenceFor(
  kind: NotificationKind,
): keyof getNotificationPreferences.Preferences | undefined {
  return kind === 'review_requested' || kind === 'review_re_requested'
    ? 'emailReviewRequested'
    : kind === 'review_overdue'
      ? 'emailReviewOverdue'
      : undefined
}

/** The preference that controls the push for a kind; undefined for kinds that are not pushed. */
export function pushPreferenceFor(
  kind: NotificationKind,
): keyof getNotificationPreferences.Preferences | undefined {
  switch (kind) {
    case 'review_requested':
    case 'review_re_requested':
    case 'review_overdue':
      return 'pushReviewRequested'
    case 'mentioned':
      return 'pushMentioned'
    case 'build_approved':
    case 'build_rejected':
      return 'pushReviewOutcome'
    default:
      return undefined
  }
}

export async function createNotification(
  db: Database,
  input: createNotification.Input,
): Promise<Notification> {
  const [row] = await db
    .insert(notifications)
    .values({
      userId: input.userId,
      kind: input.kind,
      buildId: input.buildId ?? null,
      actorId: input.actorId ?? null,
      payload: input.payload ?? {},
    })
    .returning()
  if (!row) throw new Error('insert returned no row')
  return row
}
export namespace createNotification {
  export interface Input {
    userId: string
    kind: NotificationKind
    buildId?: string | null
    actorId?: string | null
    payload?: Record<string, unknown>
  }
}

/**
 * Marks a user's unread notifications about a build as read (optionally only some kinds).
 * Returns how many it changed.
 */
export async function markBuildNotificationsRead(
  db: Database,
  input: { userId: string; buildId: string; kinds?: readonly NotificationKind[] },
): Promise<number> {
  const rows = await db
    .update(notifications)
    .set({ readAt: sql`now()` })
    .where(
      and(
        eq(notifications.userId, input.userId),
        eq(notifications.buildId, input.buildId),
        isNull(notifications.readAt),
        isNull(notifications.deletedAt),
        ...(input.kinds ? [inArray(notifications.kind, [...input.kinds])] : []),
      ),
    )
    .returning({ id: notifications.id })
  return rows.length
}

/** Marks one notification read or unread; undefined when the user has no such notification. */
export async function setNotificationRead(
  db: Database,
  input: { userId: string; id: string; read: boolean },
): Promise<Notification | undefined> {
  const [row] = await db
    .update(notifications)
    .set({ readAt: input.read ? sql`coalesce(${notifications.readAt}, now())` : null })
    .where(ownNotification(input))
    .returning()
  return row
}

/** Hides one notification until `until`, or brings it back with null. */
export async function snoozeNotification(
  db: Database,
  input: { userId: string; id: string; until: Date | null },
): Promise<Notification | undefined> {
  const [row] = await db
    .update(notifications)
    .set({ snoozedUntil: input.until })
    .where(ownNotification(input))
    .returning()
  return row
}

/** Deletes one notification (it stays in the table, flagged, and never shows again). */
export async function deleteNotification(
  db: Database,
  input: { userId: string; id: string },
): Promise<boolean> {
  const rows = await db
    .update(notifications)
    .set({ deletedAt: sql`now()` })
    .where(ownNotification(input))
    .returning({ id: notifications.id })
  return rows.length > 0
}

/** Marks everything a user has not read as read; returns how many it changed. */
export async function markAllNotificationsRead(
  db: Database,
  input: { userId: string },
): Promise<number> {
  const rows = await db
    .update(notifications)
    .set({ readAt: sql`now()` })
    .where(
      and(
        eq(notifications.userId, input.userId),
        isNull(notifications.readAt),
        isNull(notifications.deletedAt),
      ),
    )
    .returning({ id: notifications.id })
  return rows.length
}

function ownNotification(input: { userId: string; id: string }) {
  return and(
    eq(notifications.id, input.id),
    eq(notifications.userId, input.userId),
    isNull(notifications.deletedAt),
  )
}

/** Whether the user has had a review request for the build that already closed. */
export async function hasClosedReviewRequest(
  db: Database,
  input: { buildId: string; reviewerId: string; exceptId?: string },
): Promise<boolean> {
  const [row] = await db
    .select({ id: reviewRequests.id })
    .from(reviewRequests)
    .where(
      and(
        eq(reviewRequests.buildId, input.buildId),
        eq(reviewRequests.reviewerId, input.reviewerId),
        ne(reviewRequests.state, 'open'),
        ...(input.exceptId ? [ne(reviewRequests.id, input.exceptId)] : []),
      ),
    )
    .limit(1)
  return row !== undefined
}

/** Changes the given preferences; the others keep their value (default on). */
export async function setNotificationPreferences(
  db: Database,
  userId: string,
  changes: Partial<getNotificationPreferences.Preferences>,
): Promise<getNotificationPreferences.Preferences> {
  await db
    .insert(notificationPreferences)
    .values({ userId, ...changes })
    .onConflictDoUpdate({
      target: notificationPreferences.userId,
      set: { ...changes, updatedAt: sql`now()` },
    })
  return getNotificationPreferences(db, userId)
}

export namespace getNotificationEmailData {
  /** What the email job needs to write to one person about one notification. */
  export interface Data {
    notification: Notification
    recipient: { id: string; name: string; email: string }
    actorName: string | null
    build: {
      number: number
      branch: string | null
      projectslug: string
      projectName: string
      workspaceSlug: string
    } | null
    preferences: getNotificationPreferences.Preferences
  }
}

export async function getNotificationEmailData(
  db: Database,
  id: string,
): Promise<getNotificationEmailData.Data | undefined> {
  const [row] = await db
    .select({ notification: notifications, recipient: user })
    .from(notifications)
    .innerJoin(user, eq(user.id, notifications.userId))
    .where(eq(notifications.id, id))
  if (!row) return undefined
  const n = row.notification
  const [actor] = n.actorId
    ? await db.select({ name: user.name }).from(user).where(eq(user.id, n.actorId))
    : []
  const [build] = n.buildId
    ? await db
        .select({
          number: builds.number,
          branch: builds.branch,
          projectslug: projects.slug,
          projectName: projects.name,
          workspaceSlug: workspace.slug,
        })
        .from(builds)
        .innerJoin(projects, eq(projects.id, builds.projectId))
        .innerJoin(workspace, eq(workspace.id, projects.workspaceId))
        .where(eq(builds.id, n.buildId))
    : []
  return {
    notification: n,
    recipient: { id: row.recipient.id, name: row.recipient.name, email: row.recipient.email },
    actorName: actor?.name ?? null,
    build: build ?? null,
    preferences: await getNotificationPreferences(db, n.userId),
  }
}

/** What an inbox action can change on a notification, as it is stored. */
export interface NotificationFields {
  readAt: Date | null
  snoozedUntil: Date | null
  deletedAt: Date | null
}

/** A user's notification as stored, including a removed one (an undo can bring it back). */
export async function getNotificationFields(
  db: Database,
  input: { userId: string; id: string },
): Promise<NotificationFields | undefined> {
  const [row] = await db
    .select({
      readAt: notifications.readAt,
      snoozedUntil: notifications.snoozedUntil,
      deletedAt: notifications.deletedAt,
    })
    .from(notifications)
    .where(and(eq(notifications.id, input.id), eq(notifications.userId, input.userId)))
  return row
}

/** Puts a user's notification back to the given read, snooze and removed state. */
export async function restoreNotificationFields(
  db: Database,
  input: { userId: string; id: string } & NotificationFields,
): Promise<boolean> {
  const rows = await db
    .update(notifications)
    .set({ readAt: input.readAt, snoozedUntil: input.snoozedUntil, deletedAt: input.deletedAt })
    .where(and(eq(notifications.id, input.id), eq(notifications.userId, input.userId)))
    .returning({ id: notifications.id })
  return rows.length > 0
}

/** Removes the notifications of `ids` (the change that made them was undone). */
export async function deleteNotificationsById(db: Database, ids: string[]): Promise<void> {
  if (ids.length === 0) return
  await db
    .update(notifications)
    .set({ deletedAt: sql`coalesce(${notifications.deletedAt}, now())` })
    .where(inArray(notifications.id, ids))
}
