import {
  claimJob,
  completeJob,
  type Database,
  failJob,
  GIT_NOTIFY_QUEUE,
  type Job,
  QUEUES,
} from '@circi/db'
import type { GithubApp } from '@circi/providers'
import { expireStalledBuilds, failBuild, runRetention } from '@circi/services'
import type { StorageDriver } from '@circi/storage'

import { deliverWebhook } from './jobs/deliver-webhook.ts'
import { notifyGit } from './jobs/notify-git.ts'
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
  /** The dashboard's origin (`PUBLIC_URL`), used for links in webhook bodies. */
  publicOrigin?: string
  /** The GitHub App, when configured: builds are then reported to linked repositories. */
  github?: GithubApp
  /** Webhooks may point at private addresses (`WEBHOOK_ALLOW_PRIVATE_ADDRESSES`). */
  webhookAllowPrivate?: boolean
  /** Startup check of the database connection. */
  ping?: () => Promise<void>
  /** How long to wait when the queue is empty. Default 1 s. */
  pollIntervalMs?: number
  /** Builds processed at the same time. Default 2. */
  concurrency?: number
  /** Builds still uploading after this many minutes are failed (default 60); 0 turns it off. */
  uploadTimeoutMinutes?: number
  /** How long a file waits, once nothing uses it, before it's deleted (default 24 hours). */
  gcGraceHours?: number
  /** How often retention runs: expiring old builds and sites, collecting files (default 6 hours); 0 turns it off. */
  retentionIntervalMs?: number
  /** How often to look for them (default 5 minutes). */
  maintenanceIntervalMs?: number
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
        job = await claimNext(deps.db, lockSeconds)
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

  const timeoutMinutes = deps.uploadTimeoutMinutes ?? 60
  const maintenance =
    timeoutMinutes > 0
      ? setInterval(
          () => {
            expireStalledBuilds(deps.db, new Date(Date.now() - timeoutMinutes * 60_000)).then(
              (n) => {
                if (n > 0) deps.logger.warn({ builds: n }, 'failed builds that stopped uploading')
              },
              (err: unknown) => deps.logger.error({ err }, 'could not expire stalled builds'),
            )
          },
          deps.maintenanceIntervalMs ?? 5 * 60_000,
        )
      : undefined
  maintenance?.unref()

  const retentionEvery = deps.retentionIntervalMs ?? 6 * 3600_000
  const retention =
    retentionEvery > 0
      ? setInterval(() => {
          runRetention(deps.db, {
            graceMs: (deps.gcGraceHours ?? 24) * 3600_000,
            deleteObject: (key) => deps.storage.delete(key),
          }).then(
            (r) => deps.logger.info(r, 'retention pass finished'),
            (err: unknown) => deps.logger.error({ err }, 'retention pass failed'),
          )
        }, retentionEvery)
      : undefined
  retention?.unref()

  deps.logger.info({ storage: deps.storage.kind, lanes }, 'worker started')
  return {
    async stop() {
      state.running = false
      if (maintenance) clearInterval(maintenance)
      if (retention) clearInterval(retention)
      for (const s of sleepers) s.wake()
      await Promise.all(loops)
      deps.logger.info('worker stopped')
    },
  }
}

/** Builds first: a webhook is never worth delaying a diff for. */
async function claimNext(db: Database, lockSeconds: number): Promise<Job | undefined> {
  return (
    (await claimJob(db, QUEUES.processBuild, lockSeconds)) ??
    (await claimJob(db, GIT_NOTIFY_QUEUE, lockSeconds)) ??
    (await claimJob(db, QUEUES.webhook, lockSeconds))
  )
}

async function runJob(deps: WorkerDeps, job: Job): Promise<void> {
  if (job.queue === QUEUES.webhook) return runWebhookJob(deps, job)
  if (job.queue === GIT_NOTIFY_QUEUE) return runGitNotifyJob(deps, job)
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

async function runWebhookJob(deps: WorkerDeps, job: Job): Promise<void> {
  const fields = { jobId: job.id, webhookId: job.payload.webhookId, event: job.payload.event }
  try {
    const result = await deliverWebhook(
      {
        db: deps.db,
        ...(deps.publicOrigin ? { publicOrigin: deps.publicOrigin } : {}),
        ...(deps.webhookAllowPrivate ? { allowPrivate: true } : {}),
      },
      job,
    )
    await completeJob(deps.db, job.id)
    deps.logger.info({ ...fields, ...result }, 'webhook processed')
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const willRetry = await failJob(deps.db, job, message).catch(() => true)
    deps.logger[willRetry ? 'warn' : 'error'](
      { ...fields, attempt: job.attempts, err: message },
      willRetry ? 'webhook delivery failed, will retry' : 'webhook delivery failed for good',
    )
  }
}

async function runGitNotifyJob(deps: WorkerDeps, job: Job): Promise<void> {
  const fields = { jobId: job.id, buildId: job.payload.buildId }
  try {
    const result = await notifyGit(
      { db: deps.db, github: deps.github, publicOrigin: deps.publicOrigin ?? '' },
      job,
    )
    await completeJob(deps.db, job.id)
    deps.logger.info({ ...fields, ...result }, 'git host notified')
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const willRetry = await failJob(deps.db, job, message).catch(() => true)
    deps.logger[willRetry ? 'warn' : 'error'](
      { ...fields, attempt: job.attempts, err: message },
      willRetry ? 'could not notify the git host, will retry' : 'could not notify the git host',
    )
  }
}
