import { index, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core'

import { createdAt, id } from './_columns.ts'
import { user } from './auth.ts'

/** Sign-in code requests per email address, so no address can be flooded from many IPs. */
export const emailCodeRequests = pgTable(
  'email_code_requests',
  {
    id: id(),
    email: text('email').notNull(),
    requestedAt: createdAt(),
  },
  (t) => [index('email_code_requests_email_idx').on(t.email, t.requestedAt)],
)

/**
 * Browsers/devices an account has signed in from (a hash of the user agent), so a sign-in from
 * a new one can be mailed to the account's owner.
 */
export const knownDevices = pgTable(
  'known_devices',
  {
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    fingerprint: text('fingerprint').notNull(),
    firstSeen: timestamp('first_seen', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.fingerprint] })],
)
