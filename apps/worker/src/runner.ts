import {
  claimJob,
  completeJob,
  type Database,
  failBuild,
  failJob,
  type Job,
  QUEUES,
} from '@circi/db'
import type { StorageDriver } from '@circi/storage'

import { processBuild } from './jobs/process-build.ts'
import { interruptibleSleep } from './lib/concurrency.ts'

/** The worker process: polls the job queue and runs each job. */

export interface WorkerLogger {
  info(obj: object | string, msg?: string): void
  warn(obj: object | string, msg?: string): void
  error(obj: object | string, msg?: string): void
}

export interface WorkerDeps {
  db: Database
  storage: StorageDriver
  logger: WorkerLogger
  /** Startup check of the database connection. */
  ping?: () => Promise<void>
  /** How long to wait when the queue is empty. Default 1 s. */
  pollIntervalMs?: number
  /** Builds processed at the same time. Default 2. */
  concurrency?: number
  /** How long a claimed job stays locked before another worker may retry it. Default 10 min. */
  lockSeconds?: number
}

export interface RunningWorker {
  stop(): Promise<void>
}

/**
 * Polls the Postgres job queue (PLAN §2) and processes builds. Several worker processes can
 * run against one database: claiming uses `FOR UPDATE SKIP LOCKED`.
 */
export async function startWorker(deps: WorkerDeps): Promise<RunningWorker> {
  await deps.ping?.()
  await deps.storage.healthCheck()
  const pollMs = deps.pollIntervalMs ?? 1_000
  const lockSeconds = deps.lockSeconds ?? 600
  const lanes = deps.concurrency ?? 2
  // Flipped by stop(); a shared object so every lane sees the change.
  const state = { running: true }
  const sleepers = Array.from({ length: lanes }, () => interruptibleSleep())

  const loops = sleepers.map(async (sleeper) => {
    while (state.running) {
      let job: Job | undefined
      try {
        // oxlint-disable-next-line no-await-in-loop -- a poll loop claims one job at a time
        job = await claimJob(deps.db, QUEUES.processBuild, lockSeconds)
      } catch (err) {
        deps.logger.error({ err }, 'could not claim a job')
      }
      if (!job) {
        // oxlint-disable-next-line no-await-in-loop -- idle wait between polls
        await sleeper.sleep(pollMs)
        continue
      }
      // oxlint-disable-next-line no-await-in-loop -- jobs in one lane run sequentially
      await runJob(deps, job)
    }
  })

  deps.logger.info({ storage: deps.storage.kind, lanes }, 'worker started')
  return {
    async stop() {
      state.running = false
      for (const s of sleepers) s.wake()
      await Promise.all(loops)
      deps.logger.info('worker stopped')
    },
  }
}

async function runJob(deps: WorkerDeps, job: Job): Promise<void> {
  const buildId = typeof job.payload.buildId === 'string' ? job.payload.buildId : undefined
  const started = Date.now()
  try {
    if (!buildId) throw new Error('job payload has no buildId')
    const result = await processBuild({ db: deps.db, storage: deps.storage }, buildId)
    await completeJob(deps.db, job.id)
    deps.logger.info(
      { jobId: job.id, buildId, ms: Date.now() - started, ...result },
      'build processed',
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const willRetry = await failJob(deps.db, job, message).catch(() => true)
    if (willRetry) {
      deps.logger.warn(
        { jobId: job.id, buildId, attempt: job.attempts, err },
        'build processing failed, will retry',
      )
    } else {
      deps.logger.error({ jobId: job.id, buildId, err }, 'build processing failed for good')
      if (buildId) await failBuild(deps.db, buildId, message).catch(() => {})
    }
  }
}
