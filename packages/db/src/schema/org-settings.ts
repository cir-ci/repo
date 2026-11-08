import { boolean, pgTable, text, timestamp } from 'drizzle-orm/pg-core'

import { organization } from './auth.ts'

/**
 * An organization's defaults for its projects. No row means the defaults below; a project may
 * override each one.
 */
export const orgSettings = pgTable('org_settings', {
  orgId: text('org_id')
    .primaryKey()
    .references(() => organization.id, { onDelete: 'cascade' }),
  /** Whether a pull request that only changes flaky screenshots still blocks the merge. */
  flakyBlocksMerge: boolean('flaky_blocks_merge').notNull().default(true),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})
