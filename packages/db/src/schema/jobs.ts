import { sql } from 'drizzle-orm'
import {
  bigint,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core'

import { createdAt, inList } from './_columns.ts'
import { JOB_STATUSES, type JobStatus } from './enums.ts'

/**
 * Background job queue in Postgres (PLAN §2: no Redis). Workers claim jobs with
 * `FOR UPDATE SKIP LOCKED`, so several workers can share the table safely. Jobs can be
 * enqueued in the same transaction as the data they act on.
 */
export const jobs = pgTable(
  'jobs',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    queue: text('queue').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
    /** At most one pending or running job per (queue, dedupe_key). */
    dedupeKey: text('dedupe_key'),
    status: text('status').$type<JobStatus>().notNull().default('pending'),
    runAt: timestamp('run_at', { withTimezone: true }).notNull().defaultNow(),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(5),
    /** A running job whose lock expired (crashed worker) is picked up again. */
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
    lastError: text('last_error'),
    createdAt: createdAt(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => [
    index('jobs_claim_idx')
      .on(t.queue, t.runAt)
      .where(sql`${t.status} in ('pending', 'running')`),
    uniqueIndex('jobs_dedupe_key')
      .on(t.queue, t.dedupeKey)
      .where(sql`${t.dedupeKey} is not null and ${t.status} in ('pending', 'running')`),
    check('jobs_status_check', inList('status', JOB_STATUSES)),
  ],
)
