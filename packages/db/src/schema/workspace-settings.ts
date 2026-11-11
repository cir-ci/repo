import { sql } from 'drizzle-orm'
import { boolean, check, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core'

import { workspace } from './auth.ts'

/**
 * A workspace's defaults for its projects. No row means the defaults below; a project may
 * override each one.
 */
export const workspaceSettings = pgTable(
  'workspace_settings',
  {
    workspaceId: text('workspace_id')
      .primaryKey()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    /** Whether a pull request that only changes flaky screenshots still blocks the merge. */
    flakyBlocksMerge: boolean('flaky_blocks_merge').notNull().default(true),
    /** Whether new triage items go to whoever is on triage (a project may override). */
    assignTriageToOnCall: boolean('assign_triage_to_on_call').notNull().default(false),
    /** The retention (days) a new project starts with; existing projects keep their own. */
    retentionDays: integer('retention_days').notNull().default(30),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check('workspace_settings_retention_days_check', sql`${t.retentionDays} >= 1`)],
)
