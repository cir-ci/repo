import type { Job } from '@circi/db'
import { completeJob, failJob, isJobForDeletedWorkspace, QUEUES } from '@circi/services'

import { HANDLERS } from './handlers/index.ts'
import type { startWorker } from './runner.ts'

/**
 * Runs one claimed job through its handler: completes it, or records the failure (retried with
 * backoff until `maxAttempts`) and logs which of the two happened.
 */
export async function runJob(deps: startWorker.Deps, job: Job): Promise<void> {
  // Nothing is sent for a deleted workspace: webhooks, git checks, Slack, email. (Builds still
  // being processed finish: that is internal, and a restore finds them complete.)
  if (
    job.queue !== QUEUES.processBuild &&
    (await isJobForDeletedWorkspace(deps.db, job).catch(() => false))
  ) {
    await completeJob(deps.db, job.id)
    deps.logger.info({ jobId: job.id, queue: job.queue }, 'skipped a job of a deleted workspace')
    return
  }
  const handler = HANDLERS[job.queue] ?? HANDLERS[QUEUES.processBuild]
  if (!handler) return
  const fields = { jobId: job.id, ...handler.fields(job) }
  try {
    const { result, message } = await handler.run(deps, job)
    await completeJob(deps.db, job.id)
    deps.logger.info({ ...fields, ...result }, message ?? handler.done)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const willRetry = await failJob(deps.db, job, message, deps.retryBackoff).catch(() => true)
    deps.logger[willRetry ? 'warn' : 'error'](
      { ...fields, attempt: job.attempts, err: message },
      willRetry ? handler.retry : handler.failed,
    )
    if (!willRetry) await handler.onGiveUp?.(deps, job, message)
  }
}
