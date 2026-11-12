import type { Job } from '@circi/db'
import {
  completeJob,
  extendJobLease,
  failJob,
  isJobForDeletedWorkspace,
  QUEUES,
} from '@circi/services'

import { HANDLERS } from './handlers/index.ts'
import type { startWorker } from './runner.ts'

/**
 * Keeps the job's lease alive while its handler runs: every third of the lock time the lock is
 * pushed ahead again. Stops by itself when the claim is lost (another worker has the job now).
 */
function heartbeat(deps: startWorker.Deps, job: Job): { stop(): void } {
  const lockSeconds = deps.lockSeconds ?? 600
  let lost = false
  const timer = setInterval(
    () => {
      extendJobLease(deps.db, job, lockSeconds).then(
        (held) => {
          if (held || lost) return
          lost = true
          clearInterval(timer)
          deps.logger.warn({ jobId: job.id, queue: job.queue }, 'lost the lease on a running job')
        },
        (err: unknown) => deps.logger.warn({ err, jobId: job.id }, 'could not extend a job lease'),
      )
    },
    Math.max(10, (lockSeconds * 1000) / 3),
  )
  timer.unref()
  return { stop: () => clearInterval(timer) }
}

/**
 * Runs one claimed job through its handler: completes it, or records the failure (retried with
 * backoff until `maxAttempts`) and logs which of the two happened. The outcome is written only
 * while this claim still holds the job: when the lease was lost (the handler outlived its lock and
 * the job was claimed again) the result is dropped and the newer claim decides.
 */
export async function runJob(deps: startWorker.Deps, job: Job): Promise<void> {
  // Nothing is sent for a deleted workspace: webhooks, git checks, Slack, email. (Builds still
  // being processed finish: that is internal, and a restore finds them complete.)
  if (
    job.queue !== QUEUES.processBuild &&
    (await isJobForDeletedWorkspace(deps.db, job).catch(() => false))
  ) {
    await completeJob(deps.db, job)
    deps.logger.info({ jobId: job.id, queue: job.queue }, 'skipped a job of a deleted workspace')
    return
  }
  const handler = HANDLERS[job.queue] ?? HANDLERS[QUEUES.processBuild]
  if (!handler) return
  const fields = { jobId: job.id, ...handler.fields(job) }
  const beat = heartbeat(deps, job)
  try {
    const { result, message } = await handler.run(deps, job)
    beat.stop()
    if (await completeJob(deps.db, job)) {
      deps.logger.info({ ...fields, ...result }, message ?? handler.done)
    } else {
      deps.logger.warn(fields, 'finished a job whose lease was lost; the result is dropped')
    }
  } catch (err) {
    beat.stop()
    const message = err instanceof Error ? err.message : String(err)
    const outcome = await failJob(deps.db, job, message, deps.retryBackoff).catch(
      () => 'retried' as const,
    )
    if (outcome === 'lost') {
      deps.logger.warn({ ...fields, err: message }, 'a job whose lease was lost failed; ignored')
      return
    }
    const willRetry = outcome === 'retried'
    deps.logger[willRetry ? 'warn' : 'error'](
      { ...fields, attempt: job.attempts, err: message },
      willRetry ? handler.retry : handler.failed,
    )
    if (!willRetry) await handler.onGiveUp?.(deps, job, message)
  }
}
