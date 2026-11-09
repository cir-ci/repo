import type { RetryBackoff } from '@circi/core'
import type { Database, ListenFn } from '@circi/db'
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
  const lanes = startLanes(deps)
  const stopSweeps = startSweeps(deps)
  deps.logger.info({ storage: deps.storage.kind, lanes: deps.concurrency ?? 2 }, 'worker started')
  return {
    async stop() {
      stopSweeps()
      await lanes.stop()
      deps.logger.info('worker stopped')
    },
  }
}
