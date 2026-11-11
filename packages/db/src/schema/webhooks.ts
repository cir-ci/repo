import { sql } from 'drizzle-orm'
import { boolean, check, index, integer, pgTable, text, uuid } from 'drizzle-orm/pg-core'

import { createdAt, id } from './_columns.ts'
import { projects } from './projects.ts'

/**
 * A project's outgoing webhooks (PLAN §7.4). Deliveries run on the job queue, signed with the
 * webhook's secret. The secret is kept as is: signing needs it, and it only protects a receiver
 * from forged calls.
 */
export const webhooks = pgTable(
  'webhooks',
  {
    id: id(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
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
    index('webhooks_project_idx').on(t.projectId),
    check('webhooks_events_check', sql`cardinality(${t.events}) > 0`),
  ],
)

/**
 * One row per delivery attempt, for the "recent deliveries" list: what the receiver answered
 * (or why no request was made) and when. Only the newest few per webhook are kept.
 */
export const webhookDeliveries = pgTable(
  'webhook_deliveries',
  {
    id: id(),
    webhookId: uuid('webhook_id')
      .notNull()
      .references(() => webhooks.id, { onDelete: 'cascade' }),
    /** The `CirCI-Delivery` id: the same for every attempt of one event. */
    deliveryId: text('delivery_id').notNull(),
    event: text('event').notNull(),
    /** A "Send test" event rather than a build event. */
    test: boolean('test').notNull().default(false),
    /** 1 for the first try, 2 for the first retry, … */
    attempt: integer('attempt').notNull(),
    /** The receiver's HTTP status; null when no answer came (see `error`). */
    statusCode: integer('status_code'),
    error: text('error'),
    createdAt: createdAt(),
  },
  (t) => [index('webhook_deliveries_hook_idx').on(t.webhookId, t.createdAt)],
)
