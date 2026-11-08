import { boolean, pgTable, text, timestamp } from 'drizzle-orm/pg-core'

import { workspace } from './auth.ts'

/**
 * A workspace's defaults for its teams. No row means the defaults below; a team may
 * override each one.
 */
export const workspaceSettings = pgTable('workspace_settings', {
  workspaceId: text('workspace_id')
    .primaryKey()
    .references(() => workspace.id, { onDelete: 'cascade' }),
  /** Whether a pull request that only changes flaky screenshots still blocks the merge. */
  flakyBlocksMerge: boolean('flaky_blocks_merge').notNull().default(true),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})
