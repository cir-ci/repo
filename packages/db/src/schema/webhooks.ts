import { sql } from 'drizzle-orm'
import { boolean, check, index, pgTable, text, uuid } from 'drizzle-orm/pg-core'

import { createdAt, id } from './_columns.ts'
import { teams } from './teams.ts'

/**
 * A team's outgoing webhooks (PLAN §7.4). Deliveries run on the job queue, signed with the
 * webhook's secret. The secret is kept as is: signing needs it, and it only protects a receiver
 * from forged calls.
 */
export const webhooks = pgTable(
  'webhooks',
  {
    id: id(),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    url: text('url').notNull(),
    secret: text('secret').notNull(),
    /** Event names from WEBHOOK_EVENTS (checked in code: a new event needs no migration). */
    events: text('events')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    enabled: boolean('enabled').notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [
    index('webhooks_team_idx').on(t.teamId),
    check('webhooks_events_check', sql`cardinality(${t.events}) > 0`),
  ],
)
