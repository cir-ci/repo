import type { Database, Job } from '@circi/db'
import * as queue from '@circi/db/queue'
import { jobIsForDeletedWorkspace } from '@circi/db/repositories'

export { GIT_NOTIFY_QUEUE, JOBS_CHANNEL, QUEUES } from '@circi/db/queue'

/** What the worker's poll loop does with the job queue: claim, finish, fail. */

/** Builds first: a webhook is never worth delaying a diff for. */
export async function claimNextJob(db: Database, lockSeconds: number): Promise<Job | undefined> {
  return (
    (await queue.claimJob(db, queue.QUEUES.processBuild, lockSeconds)) ??
    (await queue.claimJob(db, queue.GIT_NOTIFY_QUEUE, lockSeconds)) ??
    (await queue.claimJob(db, queue.QUEUES.webhook, lockSeconds)) ??
    (await queue.claimJob(db, queue.QUEUES.notificationEmail, lockSeconds)) ??
    (await queue.claimJob(db, queue.QUEUES.integrationEvent, lockSeconds))
  )
}

/** Marks a claimed job done. */
export async function completeJob(db: Database, id: number): Promise<void> {
  await queue.completeJob(db, id)
}

/** Records a failure; resolves to whether the job will be retried (until `maxAttempts`). */
export async function failJob(db: Database, job: Job, error: string): Promise<boolean> {
  return queue.failJob(db, job, error)
}

/** Whether the job belongs to a deleted workspace (nothing is sent for those). */
export async function isJobForDeletedWorkspace(db: Database, job: Job): Promise<boolean> {
  return jobIsForDeletedWorkspace(db, job)
}
