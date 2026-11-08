import {
  claimJob,
  completeJob,
  type Database,
  failJob,
  GIT_NOTIFY_QUEUE,
  type Job,
  JOBS_CHANNEL,
  type ListenFn,
  QUEUES,
} from '@circi/db'
import type { IntegrationDefinition } from '@circi/integrations'
import type { GithubApp, ProviderRegistry } from '@circi/providers'
import { expireStalledBuilds, failBuild, runRetention } from '@circi/services'
import type { StorageDriver } from '@circi/storage'

import { deliverWebhook } from './jobs/deliver-webhook.ts'
import { integrationEvent } from './jobs/integration-event.ts'
import { notifyGit } from './jobs/notify-git.ts'
import { processBuild } from './jobs/process-build.ts'
import { reviewSweep } from './jobs/review-sweep.ts'
import { sendNotificationEmail } from './jobs/send-email.ts'
import { interruptibleSleep } from './lib/concurrency.ts'

/** The worker process: polls the job queue and runs each job. */

export namespace startWorker {
  export interface Logger {
    info(obj: object | string, msg?: string): void
    warn(obj: object | string, msg?: string): void
    error(obj: object | string, msg?: string): void
  }

  export interface Deps {
    db: Database
    storage: StorageDriver
    logger: startWorker.Logger
    /** The dashboard's origin (`PUBLIC_URL`), used for links in webhook bodies. */
    publicOrigin?: string
    /** Stands in for the GitHub App's adapter (tests); production builds it from `integrations.config.github`. */
    github?: GithubApp
    /** Stands in for the git host adapters by connection kind (tests); production uses the definitions'. */
    providers?: ProviderRegistry<notifyGit.Provider>
    /** The instance secret (`BETTER_AUTH_SECRET`): opens sealed per-connection credentials of token git hosts. */
    authSecret?: string
    /** Sends notification emails; absent without SMTP, and such jobs are then skipped. */
    mailer?: sendNotificationEmail.Sender
    /**
     * Instance settings of the integrations (`config`: the Slack app…) and a replaceable `fetch`.
     * Absent in tests that do not deliver integration events (such jobs are then dropped).
     */
    integrations?: Pick<IntegrationDefinition.Context, 'config' | 'fetch'>
    /** Webhooks may point at private addresses (`WEBHOOK_ALLOW_PRIVATE_ADDRESSES`). */
    webhookAllowPrivate?: boolean
    /** Startup check of the database connection. */
    ping?: () => Promise<void>
    /**
     * Subscribes to Postgres NOTIFY (`createDb(...).listen` in production): a queued job then wakes
     * the worker at once. Without it, or while the connection is down, the poll finds jobs.
     */
    listen?: ListenFn
    /** How long to wait when the queue is empty. Default 1 s; also the fallback for missed notifications. */
    pollIntervalMs?: number
    /** Builds processed at the same time. Default 2. */
    concurrency?: number
    /** Builds still uploading after this many minutes are failed (default 60); 0 turns it off. */
    uploadTimeoutMinutes?: number
    /** How long a file waits, once nothing uses it, before it's deleted (default 24 hours). */
    gcGraceHours?: number
    /** How often retention runs: expiring old builds and sites, collecting files (default 6 hours); 0 turns it off. */
    retentionIntervalMs?: number
    /** How often overdue review requests are looked for (default 5 minutes); 0 turns it off. */
    reviewSweepIntervalMs?: number
    /** How often to look for them (default 5 minutes). */
    maintenanceIntervalMs?: number
    /** How long a claimed job stays locked before another worker may retry it. Default 10 min. */
    lockSeconds?: number
  }

  export interface Running {
    stop(): Promise<void>
  }
}

/**
 * Polls the Postgres job queue (PLAN §2) and processes builds. Several worker processes can
 * run against one database: claiming uses `FOR UPDATE SKIP LOCKED`.
 */
export async function startWorker(deps: startWorker.Deps): Promise<startWorker.Running> {
  await deps.ping?.()
  await deps.storage.healthCheck()
  const pollMs = deps.pollIntervalMs ?? 1_000
  const lockSeconds = deps.lockSeconds ?? 600
  const lanes = deps.concurrency ?? 2
  // Flipped by stop(); a shared object so every lane sees the change.
  const state = { running: true }
  const sleepers = Array.from({ length: lanes }, () => interruptibleSleep())

  // A wake-up that arrives while a lane is busy (or between "found nothing" and "went to sleep")
  // is remembered per lane, so it is never lost; several before the lane looks count as one.
  const woken = sleepers.map(() => false)
  const wakeAll = () => {
    sleepers.forEach((s, i) => {
      woken[i] = true
      s.wake()
    })
  }
  const listener = deps.listen
    ? startListening(deps.listen, wakeAll, deps.logger, () => state.running)
    : undefined

  const loops = sleepers.map(async (sleeper, lane) => {
    while (state.running) {
      let job: Job | undefined
      woken[lane] = false
      try {
        // oxlint-disable-next-line no-await-in-loop -- a poll loop claims one job at a time
        job = await claimNext(deps.db, lockSeconds)
      } catch (err) {
        deps.logger.error({ err }, 'could not claim a job')
      }
      if (!job) {
        // oxlint-disable-next-line no-await-in-loop -- idle wait between polls
        if (!woken[lane]) await sleeper.sleep(pollMs)
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

  const sweepEvery = deps.reviewSweepIntervalMs ?? 5 * 60_000
  const sweep =
    sweepEvery > 0
      ? setInterval(() => {
          reviewSweep({ db: deps.db }).then(
            (n) => {
              if (n > 0) deps.logger.info({ reviewers: n }, 'told reviewers about overdue requests')
            },
            (err: unknown) => deps.logger.error({ err }, 'review sweep failed'),
          )
        }, sweepEvery)
      : undefined
  sweep?.unref()

  deps.logger.info({ storage: deps.storage.kind, lanes }, 'worker started')
  return {
    async stop() {
      state.running = false
      if (maintenance) clearInterval(maintenance)
      if (retention) clearInterval(retention)
      if (sweep) clearInterval(sweep)
      wakeAll()
      await listener?.stop()
      await Promise.all(loops)
      deps.logger.info('worker stopped')
    },
  }
}

const RECONNECT_MIN_MS = 500
const RECONNECT_MAX_MS = 30_000

/**
 * Keeps a LISTEN on the jobs channel alive: every notification wakes the poll loops, and a
 * dropped connection is re-established with exponential backoff. Logs once per outage, then once
 * when it is back (a wake-up follows, since notifications sent meanwhile were missed).
 */
function startListening(
  listen: ListenFn,
  wake: () => void,
  logger: startWorker.Logger,
  isRunning: () => boolean,
): { stop(): Promise<void> } {
  let unlisten: (() => Promise<void>) | undefined
  let retryTimer: NodeJS.Timeout | undefined
  let stopped = false
  let outage = false
  let delay = RECONNECT_MIN_MS

  const connect = async (): Promise<void> => {
    retryTimer = undefined
    if (stopped || !isRunning()) return
    try {
      const stop = await listen(JOBS_CHANNEL, wake, (err) => {
        unlisten = undefined
        lostConnection(err)
      })
      if (stopped) {
        await stop().catch(() => {})
        return
      }
      unlisten = stop
      delay = RECONNECT_MIN_MS
      if (outage) {
        outage = false
        logger.info('job notifications are back')
        wake()
      }
    } catch (err) {
      lostConnection(err)
    }
  }

  const lostConnection = (err: unknown): void => {
    if (stopped) return
    if (!outage) {
      outage = true
      logger.warn({ err }, 'lost the job notification connection; polling until it is back')
    }
    retryTimer = setTimeout(() => void connect(), delay)
    retryTimer.unref()
    delay = Math.min(delay * 2, RECONNECT_MAX_MS)
  }

  const first = connect()
  return {
    async stop() {
      stopped = true
      if (retryTimer) clearTimeout(retryTimer)
      await first
      await unlisten?.().catch(() => {})
      unlisten = undefined
    },
  }
}

/** Builds first: a webhook is never worth delaying a diff for. */
async function claimNext(db: Database, lockSeconds: number): Promise<Job | undefined> {
  return (
    (await claimJob(db, QUEUES.processBuild, lockSeconds)) ??
    (await claimJob(db, GIT_NOTIFY_QUEUE, lockSeconds)) ??
    (await claimJob(db, QUEUES.webhook, lockSeconds)) ??
    (await claimJob(db, QUEUES.notificationEmail, lockSeconds)) ??
    (await claimJob(db, QUEUES.integrationEvent, lockSeconds))
  )
}

async function runJob(deps: startWorker.Deps, job: Job): Promise<void> {
  if (job.queue === QUEUES.webhook) return runWebhookJob(deps, job)
  if (job.queue === GIT_NOTIFY_QUEUE) return runGitNotifyJob(deps, job)
  if (job.queue === QUEUES.notificationEmail) return runEmailJob(deps, job)
  if (job.queue === QUEUES.integrationEvent) return runIntegrationEventJob(deps, job)
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

async function runWebhookJob(deps: startWorker.Deps, job: Job): Promise<void> {
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

async function runGitNotifyJob(deps: startWorker.Deps, job: Job): Promise<void> {
  const fields = { jobId: job.id, buildId: job.payload.buildId }
  try {
    const result = await notifyGit(
      {
        db: deps.db,
        context: deps.integrations,
        github: deps.github,
        providers: deps.providers,
        publicOrigin: deps.publicOrigin ?? '',
        authSecret: deps.authSecret,
      },
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

async function runEmailJob(deps: startWorker.Deps, job: Job): Promise<void> {
  const fields = { jobId: job.id, notificationId: job.payload.notificationId }
  try {
    const result = await sendNotificationEmail(
      {
        db: deps.db,
        ...(deps.mailer ? { mailer: deps.mailer } : {}),
        ...(deps.publicOrigin ? { publicOrigin: deps.publicOrigin } : {}),
      },
      job,
    )
    await completeJob(deps.db, job.id)
    deps.logger.info({ ...fields, ...result }, 'notification email processed')
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const willRetry = await failJob(deps.db, job, message).catch(() => true)
    deps.logger[willRetry ? 'warn' : 'error'](
      { ...fields, attempt: job.attempts, err: message },
      willRetry
        ? 'could not send a notification email, will retry'
        : 'could not send a notification email',
    )
  }
}

async function runIntegrationEventJob(deps: startWorker.Deps, job: Job): Promise<void> {
  const event: unknown = job.payload.event
  const fields = {
    jobId: job.id,
    integrationId: job.payload.integrationId,
    event: typeof event === 'object' && event !== null && 'type' in event ? event.type : undefined,
  }
  try {
    if (!deps.integrations || !deps.authSecret) {
      await completeJob(deps.db, job.id)
      deps.logger.info(
        fields,
        'integration event skipped: integrations are not set up in this worker',
      )
      return
    }
    const result = await integrationEvent(
      {
        db: deps.db,
        context: {
          authSecret: deps.authSecret,
          publicOrigin: deps.publicOrigin ?? '',
          config: deps.integrations.config,
          ...(deps.integrations.fetch ? { fetch: deps.integrations.fetch } : {}),
        },
      },
      job,
    )
    await completeJob(deps.db, job.id)
    deps.logger.info({ ...fields, ...result }, 'integration event processed')
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const willRetry = await failJob(deps.db, job, message).catch(() => true)
    deps.logger[willRetry ? 'warn' : 'error'](
      { ...fields, attempt: job.attempts, err: message },
      willRetry
        ? 'could not deliver an integration event, will retry'
        : 'could not deliver an integration event',
    )
  }
}
