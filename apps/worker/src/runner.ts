import type { RetryBackoff } from '@circi/core'
import type { Database, ListenFn } from '@circi/db'
import { closeDiffPool, configureDiffPool, type DiffEngine, resolveDiffEngine } from '@circi/diff'
import type { IntegrationDefinition } from '@circi/integrations'
import { type ProviderRegistry } from '@circi/integrations/git'
import { type GithubApp } from '@circi/integrations/github'
import type { StorageDriver } from '@circi/storage'

import { startLanes } from './claim-loop.ts'
import type { notifyGit } from './jobs/notify-git.ts'
import type { sendNotificationEmail } from './jobs/send-email.ts'
import { startSweeps } from './sweeps.ts'

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
    /** The sites domain (`STATIC_SITES_HOST`), when static site hosting is on: the PR comment lists a commit's sites. */
    sitesHost?: string
    /** Stands in for the GitHub App's adapter (tests); production builds it from `integrations.config.github`. */
    github?: GithubApp
    /** Stands in for the git host adapters by connection kind (tests); production uses the definitions'. */
    providers?: ProviderRegistry<notifyGit.Provider>
    /** The instance secret (`BETTER_AUTH_SECRET`): opens sealed per-connection credentials of token git hosts. */
    authSecret?: string
    /** Sends notification emails; absent without SMTP, and such jobs are then skipped. */
    mailer?: sendNotificationEmail.Sender
    /** Web push from this server: the contact in the requests, the operator's keys (else the database's) and the push service's edge. */
    push?: {
      subject: string
      vapid?: { publicKey: string; privateKey: string } | undefined
      fetch?: typeof fetch
      /** Push to private addresses too (tests). */
      allowPrivate?: boolean
      resolve?: (host: string) => Promise<string[]>
    }
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
    /** How long to wait when the queue is empty; also the fallback for missed notifications. Default 5 s with `listen`, else 1 s. */
    pollIntervalMs?: number
    /** Builds processed at the same time. Default 2. */
    concurrency?: number
    /** Extra lanes that never take a build (webhooks, git checks, email, Slack). Default 1. */
    lightLanes?: number
    /** Builds still uploading after this many minutes are failed (default 60); 0 turns it off. */
    uploadTimeoutMinutes?: number
    /** Pixel comparison engine (`CIRCI_DIFF_ENGINE`, default `js`); `native` and `js-workers` fall back to `js` with a warning when they can't run. */
    diffEngine?: DiffEngine
    /** Threads of the `js-workers` engine (`CIRCI_DIFF_THREADS`); default one less than the cores, at least 1. */
    diffThreads?: number
    /** How long a file waits, once nothing uses it, before it's deleted (default 24 hours). */
    gcGraceHours?: number
    /** How often retention runs: expiring old builds and sites, collecting files (default 6 hours); 0 turns it off. */
    retentionIntervalMs?: number
    /** How often overdue review requests are looked for (default 5 minutes); 0 turns it off. */
    reviewSweepIntervalMs?: number
    /** How often triage items nobody has go to the person on triage, for projects that want it (default 5 minutes); 0 turns it off. */
    triageAssignIntervalMs?: number
    /** Days a done or failed job is kept before the pruning sweep deletes it (default 14); 0 keeps them. */
    jobRetentionDays?: number
    /** How often finished jobs are pruned (default 1 hour). */
    jobPruneIntervalMs?: number
    /** How often to look for them (default 5 minutes). */
    maintenanceIntervalMs?: number
    /** How long a claimed job stays locked before another worker may retry it. Default 10 min. */
    lockSeconds?: number
    /** Waits between attempts of a failed job (default 2 s doubling, up to 5 minutes). */
    retryBackoff?: RetryBackoff
    /** How long a webhook receiver may take to answer (default 10 s). */
    webhookTimeoutMs?: number
  }

  export interface Running {
    stop(): Promise<void>
  }
}

/**
 * Starts the worker: poll lanes over the Postgres job queue (PLAN §2) plus the interval sweeps.
 * Several worker processes can run against one database.
 */
export async function startWorker(deps: startWorker.Deps): Promise<startWorker.Running> {
  await deps.ping?.()
  await deps.storage.healthCheck()
  // Once, here: a native engine that can't load is warned about now and the JS one runs.
  const diffEngine = resolveDiffEngine(deps.diffEngine ?? 'js', (message) =>
    deps.logger.warn(message),
  )
  configureDiffPool({
    ...(deps.diffThreads ? { threads: deps.diffThreads } : {}),
    warn: (message) => deps.logger.warn(message),
  })
  const lanes = startLanes({ ...deps, diffEngine })
  const stopSweeps = startSweeps(deps)
  deps.logger.info(
    {
      storage: deps.storage.kind,
      lanes: (deps.concurrency ?? 2) + (deps.lightLanes ?? 1),
      diffEngine,
      ...(diffEngine === 'js-workers' && deps.diffThreads ? { diffThreads: deps.diffThreads } : {}),
    },
    'worker started',
  )
  return {
    async stop() {
      stopSweeps()
      await lanes.stop()
      await closeDiffPool()
      deps.logger.info('worker stopped')
    },
  }
}
