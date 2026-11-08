import { fileURLToPath } from 'node:url'

import { runMigrations } from '@circi/db'
import { type RunningWorker, startWorker } from '@circi/worker'
import type { FastifyInstance } from 'fastify'

import { buildServer } from '../http/app.ts'
import { createRuntime } from './runtime.ts'
import { serverOptionsFor } from './server-options.ts'
import { createShutdown } from './shutdown.ts'
import { announceStartup } from './startup.ts'

export interface ServiceOptions {
  http: boolean
  worker: boolean
  migrate: boolean
}

const SHUTDOWN_TIMEOUT_MS = 10_000

/** Runs `serve`, `worker` or `all` until SIGTERM/SIGINT, then shuts down gracefully. */
export async function runServices(options: ServiceOptions): Promise<void> {
  const rt = createRuntime()
  const { logger } = rt
  let app: FastifyInstance | undefined
  let worker: RunningWorker | undefined

  const shutdown = createShutdown({
    logger,
    close: async () => {
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
      await runMigrations(rt.db)
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
        webhookAllowPrivate: rt.config.webhookAllowPrivate,
        uploadTimeoutMinutes: rt.config.uploadTimeoutMinutes,
        gcGraceHours: rt.config.gcGraceHours,
        ...(rt.github ? { github: rt.github } : {}),
      })
    }
    if (options.http) {
      app = buildServer(serverOptionsFor(rt, webDistPath()))
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
 * apps/web/dist, found from src/lifecycle/ (two folders below apps/server) in development. The
 * server bundle is one file elsewhere, so the image points `CIRCI_WEB_DIST` at the copy it ships
 * (deploy/Dockerfile). Moving this file means changing the path; `test/lifecycle/web-dist.test.ts`
 * pins the result.
 */
export function webDistPath(): string {
  return process.env.CIRCI_WEB_DIST ?? fileURLToPath(new URL('../../../web/dist', import.meta.url))
}
