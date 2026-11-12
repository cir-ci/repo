import { sql } from 'drizzle-orm'
import { boolean, check, index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'

import { createdAt, id, inList } from './_columns.ts'
import { user } from './auth.ts'
import { builds } from './builds.ts'
import { NOTIFICATION_KINDS, type NotificationKind } from './enums.ts'

/**
 * Inbox notifications: something a person should know about. Written by `@circi/services` in the
 * same transaction as the change they report. Reading, snoozing and deleting only set a
 * timestamp; a deleted row stays (`deleted_at`) so it can't come back as a duplicate.
 */

export const notifications = pgTable(
  'notifications',
  {
    id: id(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    kind: text('kind').$type<NotificationKind>().notNull(),
    /** The build it is about; null for notices about a connection or a project. */
    buildId: uuid('build_id').references(() => builds.id, { onDelete: 'cascade' }),
    /** Who caused it; null for the system (a rule, the sweep) or a deleted account. */
    actorId: text('actor_id').references(() => user.id, { onDelete: 'set null' }),
    /** Kind-specific details, e.g. the reject reason of `build_rejected`. */
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
    readAt: timestamp('read_at', { withTimezone: true }),
    /** Hidden from the inbox until then. */
    snoozedUntil: timestamp('snoozed_until', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index('notifications_user_idx').on(t.userId, t.createdAt),
    index('notifications_build_idx').on(t.buildId, t.userId),
    index('notifications_actor_idx').on(t.actorId),
    check('notifications_kind_check', inList('kind', NOTIFICATION_KINDS)),
  ],
)

/**
 * Which notifications a person also gets by email, and which kinds go to their devices as web
 * push. One row per person who changed anything; no row means the defaults (all on). Email is only
 * sent when the instance has SMTP; push only to devices that turned it on (`push_subscriptions`).
 */
export const notificationPreferences = pgTable('notification_preferences', {
  userId: text('user_id')
    .primaryKey()
    .references(() => user.id, { onDelete: 'cascade' }),
  emailReviewRequested: boolean('email_review_requested').notNull().default(true),
  emailReviewOverdue: boolean('email_review_overdue').notNull().default(true),
  pushReviewRequested: boolean('push_review_requested').notNull().default(true),
  pushMentioned: boolean('push_mentioned').notNull().default(true),
  pushReviewOutcome: boolean('push_review_outcome').notNull().default(true),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .default(sql`now()`),
})
