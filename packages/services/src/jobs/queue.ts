import type { RetryBackoff } from '@circi/core'
import type { Database, Job } from '@circi/db'
import * as queue from '@circi/db/queue'
import { jobIsForDeletedWorkspace } from '@circi/db/repositories'

export { GIT_NOTIFY_QUEUE, JOBS_CHANNEL, QUEUES } from '@circi/db/queue'

/** What the worker's poll loop does with the job queue: claim, finish, fail. */

/** Claim order: builds first, then the light queues (a webhook is never worth delaying a diff for). */
const ALL_QUEUES = [
  queue.QUEUES.processBuild,
  queue.GIT_NOTIFY_QUEUE,
  queue.QUEUES.webhook,
  queue.QUEUES.notificationEmail,
  queue.QUEUES.integrationEvent,
] as const

/** Everything but builds: what the lanes reserved for light work claim, so a backlog of builds can't starve them. */
const LIGHT_QUEUES = ALL_QUEUES.filter((q) => q !== queue.QUEUES.processBuild)

/**
 * Claims the next job in one query. A `light` lane never takes a build; the others take builds
 * first and light jobs when there are no builds.
 */
export async function claimNextJob(
  db: Database,
  lockSeconds: number,
  options: { light?: boolean } = {},
): Promise<Job | undefined> {
  return queue.claimJob(db, options.light ? LIGHT_QUEUES : ALL_QUEUES, lockSeconds)
}

/**
 * Fails the running jobs whose lease expired with no attempts left (their worker keeps dying), in
 * every queue the worker serves, and returns them so the worker can run each one's give-up.
 */
export async function failExpiredJobs(db: Database): Promise<Job[]> {
  return queue.failExpiredJobs(db, ALL_QUEUES)
}

/** Marks a claimed job done; false when its lease was lost (the job was claimed again). */
export async function completeJob(db: Database, claim: Pick<Job, 'id' | 'attempts'>) {
  return queue.completeJob(db, claim)
}

/** Heartbeat: keeps a running job leased for `lockSeconds` more; false when the lease was lost. */
export async function extendJobLease(
  db: Database,
  claim: Pick<Job, 'id' | 'attempts'>,
  lockSeconds: number,
) {
  return queue.extendLease(db, claim, lockSeconds)
}

/** Records a failure; resolves to `retried`, `failed` (out of attempts) or `lost` (the lease was taken over; nothing written). */
export async function failJob(
  db: Database,
  job: Job,
  error: string,
  backoff?: RetryBackoff,
): Promise<'retried' | 'failed' | 'lost'> {
  return queue.failJob(db, job, error, backoff)
}

/** Whether the job belongs to a deleted workspace (nothing is sent for those). */
export async function isJobForDeletedWorkspace(db: Database, job: Job): Promise<boolean> {
  return jobIsForDeletedWorkspace(db, job)
}
