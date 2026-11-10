import { index, pgTable, text, timestamp } from 'drizzle-orm/pg-core'

import { createdAt, id } from './_columns.ts'
import { user } from './auth.ts'

/**
 * One row per browser that turned on web push for a person: where the browser's push service
 * takes messages (`endpoint`, unique: the same browser is never twice) and the keys the payload
 * is encrypted with. Deleted when the person removes the device, when the push service says the
 * endpoint is gone (404, 410), or with the account.
 */
export const pushSubscriptions = pgTable(
  'push_subscriptions',
  {
    id: id(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    endpoint: text('endpoint').notNull().unique(),
    p256dh: text('p256dh').notNull(),
    auth: text('auth').notNull(),
    userAgent: text('user_agent'),
    /** What the settings list calls the device, e.g. "Pixel 8 · Chrome". */
    label: text('label').notNull(),
    createdAt: createdAt(),
    /** The last time a push to it was accepted by the push service. */
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  },
  (t) => [index('push_subscriptions_user_idx').on(t.userId)],
)

export type PushSubscriptionRow = typeof pushSubscriptions.$inferSelect
