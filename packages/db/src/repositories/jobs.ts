import { and, eq, lt, lte, or, sql } from 'drizzle-orm'

import type { Database } from '../client.ts'
import { jobs } from '../schema/index.ts'
import type { Job } from '../types.ts'

/** The Postgres job queue (PLAN §2): enqueue, claim with SKIP LOCKED, finish or retry. */

export const QUEUES = {
  /** Resolve the baseline, diff every screenshot, finish the build (PLAN §7.3). */
  processBuild: 'process-build',
  /** Send one outgoing webhook delivery (PLAN §7.4). */
  webhook: 'webhook',
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
 * Claims the next due job. `FOR UPDATE SKIP LOCKED` lets several workers poll the same queue
 * without taking the same job; a running job whose lock expired (its worker died) is due again.
 */
export async function claimJob(
  db: Database,
  queue: string,
  lockSeconds: number,
): Promise<Job | undefined> {
  return db.transaction(async (tx) => {
    const [next] = await tx
      .select({ id: jobs.id })
      .from(jobs)
      .where(
        and(
          eq(jobs.queue, queue),
          or(
            and(eq(jobs.status, 'pending'), lte(jobs.runAt, sql`now()`)),
            and(eq(jobs.status, 'running'), lt(jobs.lockedUntil, sql`now()`)),
          ),
        ),
      )
      .orderBy(jobs.runAt, jobs.id)
      .limit(1)
      .for('update', { skipLocked: true })
    if (!next) return undefined
    const [job] = await tx
      .update(jobs)
      .set({
        status: 'running',
        attempts: sql`${jobs.attempts} + 1`,
        lockedUntil: sql`now() + make_interval(secs => ${lockSeconds})`,
      })
      .where(eq(jobs.id, next.id))
      .returning()
    return job
  })
}

export async function completeJob(db: Database, id: number): Promise<void> {
  await db
    .update(jobs)
    .set({ status: 'done', finishedAt: new Date(), lockedUntil: null, lastError: null })
    .where(and(eq(jobs.id, id), eq(jobs.status, 'running')))
}

/**
 * Records a failure. Retries with exponential backoff (2s, 4s, 8s, … capped at 5 min) until
 * `max_attempts`, then marks the job `failed`. Returns whether it will be retried.
 */
export async function failJob(db: Database, job: Job, error: string): Promise<boolean> {
  const retry = job.attempts < job.maxAttempts
  const backoffSeconds = Math.min(300, 2 ** job.attempts)
  await db
    .update(jobs)
    .set(
      retry
        ? {
            status: 'pending',
            runAt: new Date(Date.now() + backoffSeconds * 1000),
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
    .where(eq(jobs.id, job.id))
  return retry
}
