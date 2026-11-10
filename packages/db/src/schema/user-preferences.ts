import { sql } from 'drizzle-orm'
import { pgTable, text, timestamp } from 'drizzle-orm/pg-core'

import { user, workspace } from './auth.ts'

/**
 * Personal preferences that follow the account across devices. One row per person who has any;
 * no row means the defaults. (Email preferences are `notification_preferences`.)
 */
export const userPreferences = pgTable('user_preferences', {
  userId: text('user_id')
    .primaryKey()
    .references(() => user.id, { onDelete: 'cascade' }),
  /** The workspace the person opened last. Cleared when that workspace is purged. */
  lastWorkspaceId: text('last_workspace_id').references(() => workspace.id, {
    onDelete: 'set null',
  }),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .default(sql`now()`),
})
