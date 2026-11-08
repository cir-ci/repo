import { integer, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core'

import { createdAt } from './_columns.ts'
import { builds } from './builds.ts'
import { teams } from './teams.ts'

/** The check run that shows a build on its commit, so later changes update the same one. */
export const buildChecks = pgTable('build_checks', {
  buildId: uuid('build_id')
    .primaryKey()
    .references(() => builds.id, { onDelete: 'cascade' }),
  checkRunId: text('check_run_id').notNull(),
  /** When the check run was first created; shown in the build's activity. */
  createdAt: createdAt(),
})

/** The one summary comment per pull request, found again to be edited in place. */
export const prComments = pgTable(
  'pr_comments',
  {
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    prNumber: integer('pr_number').notNull(),
    commentId: text('comment_id').notNull(),
  },
  (t) => [primaryKey({ columns: [t.teamId, t.prNumber] })],
)

/** Webhook deliveries already handled, so GitHub's retries and replays do nothing twice. */
export const providerDeliveries = pgTable('provider_deliveries', {
  deliveryId: text('delivery_id').primaryKey(),
  receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
})
