import { boolean, check, pgTable, text, timestamp } from 'drizzle-orm/pg-core'

import { inList } from './_columns.ts'
import { organization, session } from './auth.ts'
import { LOGIN_METHODS } from './enums.ts'

/**
 * Which login methods an organization accepts (PLAN §7.8). Organizations can only narrow what
 * the instance allows. No row means everything is accepted.
 */
export const orgAuthSettings = pgTable('org_auth_settings', {
  orgId: text('org_id')
    .primaryKey()
    .references(() => organization.id, { onDelete: 'cascade' }),
  emailLoginEnabled: boolean('email_login_enabled').notNull().default(true),
  passwordLoginEnabled: boolean('password_login_enabled').notNull().default(true),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

/** How each session signed in, so an organization's rules can be applied to its content. */
export const sessionMethods = pgTable(
  'session_methods',
  {
    sessionId: text('session_id')
      .primaryKey()
      .references(() => session.id, { onDelete: 'cascade' }),
    method: text('method').notNull(),
  },
  (t) => [check('session_methods_method_check', inList(t.method.name, LOGIN_METHODS))],
)
