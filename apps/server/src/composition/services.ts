import { fileURLToPath } from 'node:url'

import type { Config } from '@circi/config'
import { runMigrations } from '@circi/db'
import { INSTANCE_CONFIG_TTL_MS } from '@circi/services'
import { startWorker } from '@circi/worker'
import type { FastifyInstance } from 'fastify'

import { buildServer } from '#http/app.ts'

import { GITHUB_APP_TTL_MS, githubAppSync, useStoredGithubApp } from './github-app.ts'
import { applySlack, integrationConfig } from './integration-config.ts'
import { createRuntime } from './runtime.ts'
import { serverOptionsFor } from './server-options.ts'
import { createShutdown } from './shutdown.ts'
import { announceStartup } from './startup.ts'

export namespace runServices {
  export interface Options {
    http: boolean
    worker: boolean
    migrate: boolean
  }
}

const SHUTDOWN_TIMEOUT_MS = 10_000

/** Runs `serve`, `worker` or `all` until SIGTERM/SIGINT, then shuts down gracefully. */
export async function runServices(options: runServices.Options): Promise<void> {
  const rt = createRuntime()
  const { logger } = rt
  let app: FastifyInstance | undefined
  let worker: startWorker.Running | undefined
  let githubSync: githubAppSync.Sync | undefined
  let syncTimer: NodeJS.Timeout | undefined
  let settingsTimer: NodeJS.Timeout | undefined

  const shutdown = createShutdown({
    logger,
    close: async () => {
      clearInterval(syncTimer)
      clearInterval(settingsTimer)
      await app?.close()
      await worker?.stop()
      await rt.close()
    },
    exit: (code) => process.exit(code),
    timeoutMs: SHUTDOWN_TIMEOUT_MS,
  })
  process.once('SIGTERM', () => void shutdown('SIGTERM'))
  process.once('SIGINT', () => void shutdown('SIGINT'))

  for (const warning of rt.config.warnings) logger.warn(warning)

  try {
    if (options.migrate) {
      logger.info('applying database migrations')
      await runMigrations(rt.db, rt.config.migrationsFolder)
    }
    // The Slack app from the instance settings (the environment's wins), kept in step while running.
    const liveIntegrations = integrationConfig(rt.config)
    const syncSettings = async () =>
      applySlack(liveIntegrations, (await rt.instanceConfig.get()).slack)
    await syncSettings()
    rt.instanceConfig.subscribe((effective) => applySlack(liveIntegrations, effective.slack))
    settingsTimer = setInterval(() => {
      syncSettings().catch((err: unknown) =>
        logger.warn({ err }, 'could not look for changed instance settings'),
      )
    }, INSTANCE_CONFIG_TTL_MS)
    settingsTimer.unref()
    // An App created in the dashboard (the environment's wins), before anything reads the config.
    if (!rt.config.github) {
      const live = integrationConfig(rt.config)
      if (await useStoredGithubApp(rt.db.db, rt.config.authSecret, live)) {
        logger.info('using the GitHub App created in the dashboard')
      }
      // Another replica may create or change the App later: look again every TTL (and before
      // each HTTP request), so no replica needs a restart.
      const sync = githubAppSync({
        db: rt.db.db,
        authSecret: rt.config.authSecret,
        config: live,
      })
      githubSync = sync
      syncTimer = setInterval(() => {
        sync.refresh().then(
          (changed) => {
            if (changed) logger.info('the GitHub App changed in the dashboard; using the new one')
          },
          (err: unknown) => logger.warn({ err }, 'could not look for a changed GitHub App'),
        )
      }, GITHUB_APP_TTL_MS)
      syncTimer.unref()
    }
    await announceStartup(rt, options)
    if (options.worker) {
      worker = await startWorker({
        db: rt.db.db,
        storage: rt.storage,
        logger,
        ping: () => rt.db.ping(),
        listen: rt.db.listen,
        publicOrigin: rt.config.publicUrl.origin,
        ...(rt.config.staticSites ? { sitesHost: rt.config.staticSites.host } : {}),
        authSecret: rt.config.authSecret,
        webhookAllowPrivate: rt.config.webhookAllowPrivate,
        limits: async () => {
          const { limits } = await rt.instanceConfig.get()
          return {
            uploadTimeoutMinutes: limits.uploadTimeoutMinutes,
            gcGraceHours: limits.gcGraceHours,
            jobRetentionDays: limits.jobRetentionDays,
            webhookTimeoutMs: Math.round(limits.webhookTimeoutSeconds * 1000),
          }
        },
        diffEngine: rt.config.diffEngine,
        ...(rt.config.diffThreads ? { diffThreads: rt.config.diffThreads } : {}),
        retryBackoff: rt.config.jobRetry,
        integrations: { config: integrationConfig(rt.config) },
        mailer: rt.mailer,
        push: {
          subject: rt.config.vapidSubject,
          vapid: rt.config.vapid,
          allowPrivate: rt.config.webhookAllowPrivate,
        },
      })
    }
    if (options.http) {
      app = buildServer(
        serverOptionsFor({ ...rt, ...(githubSync ? { githubSync } : {}) }, webDistPath(rt.config)),
      )
      await app.listen({ host: rt.config.http.host, port: rt.config.http.port })
      logger.info(
        {
          publicUrl: rt.config.publicUrl.origin,
          ...(rt.config.previousPublicHosts.length > 0
            ? { redirectingFrom: rt.config.previousPublicHosts }
            : {}),
        },
        'http server ready',
      )
    }
  } catch (err) {
    logger.error({ err }, 'failed to start')
    await app?.close().catch(() => {})
    await worker?.stop().catch(() => {})
    await rt.close().catch(() => {})
    process.exitCode = 1
  }
}

/**
 * apps/web/dist, found from src/composition/ (two folders below apps/server) in development. The
 * server bundle is one file elsewhere, so the image points `CIRCI_WEB_DIST` at the copy it ships
 * (deploy/Dockerfile). Moving this file means changing the path; `test/composition.test.ts`
 * pins the result.
 */
export function webDistPath(config: Pick<Config, 'webDist'> = {}): string {
  return config.webDist ?? fileURLToPath(new URL('../../../web/dist', import.meta.url))
}
