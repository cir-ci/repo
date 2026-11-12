import { DEFAULT_RETRY_BACKOFF, retryDelayMs, type RetryBackoff } from '@circi/core'
import { and, eq, gte, inArray, lt, sql } from 'drizzle-orm'

import { jobs } from '#schema/index.ts'
import type { Database } from '#src/client.ts'
import type { Job } from '#src/types.ts'

/** The Postgres job queue (PLAN §2): enqueue, claim with SKIP LOCKED, finish or retry. */

export const QUEUES = {
  /** Resolve the baseline, diff every screenshot, finish the build (PLAN §7.3). */
  processBuild: 'process-build',
  /** Send one outgoing webhook delivery (PLAN §7.4). */
  webhook: 'webhook',
  /** Email one person about one notification (only when the instance has SMTP). */
  notificationEmail: 'notification-email',
  /** Hand one domain event to one integration (Slack message…); see `queueIntegrationEvent`. */
  integrationEvent: 'integration-event',
} as const

/** The Postgres channel a worker LISTENs on; the payload is the queue name. */
export const JOBS_CHANNEL = 'circi_jobs'

/**
 * Sends `NOTIFY circi_jobs, '<queue>'`. Postgres delivers a notification when the surrounding
 * transaction commits (and drops it on rollback), so a worker is woken exactly when the job
 * becomes visible: the transactional-outbox guarantee is kept.
 */
export async function notifyJobs(db: Database, queue: string): Promise<void> {
  await db.execute(sql`select pg_notify(${JOBS_CHANNEL}, ${queue})`)
}

export async function enqueueJob(
  db: Database,
  input: {
    queue: string
    payload: Record<string, unknown>
    /** At most one pending or running job per key; a duplicate enqueue is a no-op. */
    dedupeKey?: string
    runAt?: Date
    maxAttempts?: number
  },
): Promise<void> {
  await db
    .insert(jobs)
    .values({
      queue: input.queue,
      payload: input.payload,
      dedupeKey: input.dedupeKey ?? null,
      ...(input.runAt ? { runAt: input.runAt } : {}),
      ...(input.maxAttempts ? { maxAttempts: input.maxAttempts } : {}),
    })
    .onConflictDoNothing()
  // A job that is not due yet (retry backoff, a delayed run) is found by the worker's poll.
  if (!input.runAt || input.runAt.getTime() <= Date.now()) await notifyJobs(db, input.queue)
}

/**
 * Claims the next due job of any of `queues` in ONE statement (`FOR UPDATE SKIP LOCKED`, so several
 * workers and lanes can poll without taking the same job). The queues are in priority order: the
 * job of an earlier queue wins, then the one due first. A running job whose lock expired (its
 * worker died or stalled) is due again, unless it has used all its attempts: that one is never
 * claimed, `failExpiredJobs` fails it.
 *
 * `attempts` is the claim number and the fence: every claim increments it, so a handler that kept
 * running past its lease holds a number that no longer matches the row, and `completeJob`,
 * `failJob` and `extendLease` ignore it. No lease column is needed.
 */
export async function claimJob(
  db: Database,
  queues: string | readonly string[],
  lockSeconds: number,
): Promise<Job | undefined> {
  const list = typeof queues === 'string' ? [queues] : [...queues]
  if (list.length === 0) return undefined
  const queueArray = sql`array[${sql.join(
    list.map((q) => sql`${q}`),
    sql`, `,
  )}]::text[]`
  const [job] = await db
    .update(jobs)
    .set({
      status: 'running',
      attempts: sql`${jobs.attempts} + 1`,
      lockedUntil: sql`now() + make_interval(secs => ${lockSeconds})`,
    })
    .where(
      eq(
        jobs.id,
        sql`(select c.id from ${jobs} c
          where c.queue = any(${queueArray})
            and ((c.status = 'pending' and c.run_at <= now())
              or (c.status = 'running' and c.locked_until < now() and c.attempts < c.max_attempts))
          order by array_position(${queueArray}, c.queue), c.run_at, c.id
          limit 1
          for update skip locked)`,
      ),
    )
    .returning()
  return job
}

/**
 * Fails the running jobs whose lease expired with every attempt used: a job that kills its
 * worker every time (out of memory, a crash) would otherwise be claimed again for ever, or sit
 * running for ever, and its give-up step would never run. Resolves to the jobs it failed (so the
 * caller can run each one's give-up); a job whose lease is alive is never touched.
 */
export async function failExpiredJobs(db: Database, queues?: readonly string[]): Promise<Job[]> {
  if (queues?.length === 0) return []
  return db
    .update(jobs)
    .set({
      status: 'failed',
      finishedAt: new Date(),
      lockedUntil: null,
      lastError: 'lease expired too many times',
    })
    .where(
      and(
        eq(jobs.status, 'running'),
        lt(jobs.lockedUntil, sql`now()`),
        gte(jobs.attempts, jobs.maxAttempts),
        queues ? inArray(jobs.queue, [...queues]) : undefined,
      ),
    )
    .returning()
}

/** The claim a job was handed out under: its id and claim number (`attempts`). */
type Claim = Pick<Job, 'id' | 'attempts'>

const holds = (claim: Claim) =>
  and(eq(jobs.id, claim.id), eq(jobs.status, 'running'), eq(jobs.attempts, claim.attempts))

/**
 * Marks a claimed job done. Resolves to false (and changes nothing) when the claim was lost: the
 * lease expired and the job was claimed again, so the outcome belongs to the newer claim.
 */
export async function completeJob(db: Database, claim: Claim): Promise<boolean> {
  const rows = await db
    .update(jobs)
    .set({ status: 'done', finishedAt: new Date(), lockedUntil: null, lastError: null })
    .where(holds(claim))
    .returning({ id: jobs.id })
  return rows.length > 0
}

/**
 * Pushes a held job's lock `lockSeconds` ahead (the worker's heartbeat while a handler runs).
 * Resolves to false when the claim was lost: stop working on it.
 */
export async function extendLease(
  db: Database,
  claim: Claim,
  lockSeconds: number,
): Promise<boolean> {
  const rows = await db
    .update(jobs)
    .set({ lockedUntil: sql`now() + make_interval(secs => ${lockSeconds})` })
    .where(holds(claim))
    .returning({ id: jobs.id })
  return rows.length > 0
}

/**
 * Records a failure of a held claim. Retries with exponential backoff (2s, 4s, 8s, ... capped at
 * 5 min by default) until `max_attempts`, then marks the job `failed`. Resolves to `retried`,
 * `failed`, or `lost` (the claim had been taken over: nothing is written).
 */
export async function failJob(
  db: Database,
  job: Job,
  error: string,
  backoff: RetryBackoff = DEFAULT_RETRY_BACKOFF,
): Promise<'retried' | 'failed' | 'lost'> {
  const retry = job.attempts < job.maxAttempts
  const backoffMs = retryDelayMs(job.attempts, backoff)
  const rows = await db
    .update(jobs)
    .set(
      retry
        ? {
            status: 'pending',
            runAt: new Date(Date.now() + backoffMs),
            lockedUntil: null,
            lastError: error.slice(0, 4000),
          }
        : {
            status: 'failed',
            finishedAt: new Date(),
            lockedUntil: null,
            lastError: error.slice(0, 4000),
          },
    )
    .where(holds(job))
    .returning({ id: jobs.id })
  if (rows.length === 0) return 'lost'
  return retry ? 'retried' : 'failed'
}

/**
 * Deletes up to `limit` done or failed jobs that finished before `before`; resolves to how many
 * went. Call it until it returns less than `limit`. Pending and running jobs are never touched.
 */
export async function deleteFinishedJobs(
  db: Database,
  before: Date,
  limit: number,
): Promise<number> {
  const rows = await db
    .delete(jobs)
    .where(
      inArray(
        jobs.id,
        db
          .select({ id: jobs.id })
          .from(jobs)
          .where(and(inArray(jobs.status, ['done', 'failed']), lt(jobs.finishedAt, before)))
          .limit(limit),
      ),
    )
    .returning({ id: jobs.id })
  return rows.length
}
