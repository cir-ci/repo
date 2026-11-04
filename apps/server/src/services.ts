import { fileURLToPath } from 'node:url'

import { runMigrations } from '@circi/db'
import { type RunningWorker, startWorker } from '@circi/worker'
import type { FastifyInstance } from 'fastify'

import { buildServer } from './http.ts'
import { createRuntime } from './runtime.ts'

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

  let stopping = false
  const shutdown = async (signal: string) => {
    if (stopping) return
    stopping = true
    logger.info({ signal }, 'shutting down')
    const force = setTimeout(() => {
      logger.error('shutdown timed out, exiting')
      process.exit(1)
    }, SHUTDOWN_TIMEOUT_MS)
    force.unref()
    try {
      await app?.close()
      await worker?.stop()
      await rt.close()
      process.exit(0)
    } catch (err) {
      logger.error({ err }, 'error during shutdown')
      process.exit(1)
    }
  }
  process.once('SIGTERM', () => void shutdown('SIGTERM'))
  process.once('SIGINT', () => void shutdown('SIGINT'))

  for (const warning of rt.config.warnings) logger.warn(warning)

  try {
    if (options.migrate) {
      logger.info('applying database migrations')
      await runMigrations(rt.db)
    }
    if (options.worker) {
      worker = await startWorker({
        db: rt.db.db,
        storage: rt.storage,
        logger,
        ping: () => rt.db.ping(),
      })
    }
    if (options.http) {
      app = buildServer({
        logger,
        publicOrigin: rt.config.publicUrl.origin,
        previousHosts: rt.config.previousPublicHosts,
        api: { db: rt.db.db, storage: rt.storage, publicOrigin: rt.config.publicUrl.origin },
        dashboard: {
          db: rt.db.db,
          storage: rt.storage,
          ...(rt.config.dashboardPassword ? { password: rt.config.dashboardPassword } : {}),
          webDist: webDistPath(),
        },
        checks: [
          { name: 'database', check: () => rt.db.ping() },
          { name: 'storage', check: () => rt.storage.healthCheck() },
        ],
      })
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

/** apps/web/dist, from both src/ (development) and dist/ (production): both sit in apps/server. */
function webDistPath(): string {
  return process.env.CIRCI_WEB_DIST ?? fileURLToPath(new URL('../../web/dist', import.meta.url))
}
