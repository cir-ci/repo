import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify'

import type { DashboardDeps, V1Deps } from './deps.ts'
import { redirectPreviousHosts } from './hooks/previous-hosts.ts'
import { dashboardRoutes } from './routes/dashboard/index.ts'
import { healthRoutes, type ReadinessCheck } from './routes/health.ts'
import { v1Routes } from './routes/v1/index.ts'

export type { ReadinessCheck } from './routes/health.ts'

export interface ServerOptions {
  logger: FastifyBaseLogger
  checks: ReadinessCheck[]
  /** Per-check timeout for /readyz, so a hung dependency can't hang the probe. */
  checkTimeoutMs?: number
  /** Current dashboard origin (`PUBLIC_URL`), e.g. `https://ci.acme.io`. */
  publicOrigin?: string
  /** Old dashboard hosts; requests to them are permanently redirected to `publicOrigin`. */
  previousHosts?: string[]
  /** CI upload API (`/v1`). Omitted in tests that only exercise health endpoints. */
  api?: V1Deps
  /** Dashboard (`/api`, `/`). Omitted in tests that don't need it. */
  dashboard?: DashboardDeps
}

/**
 * The HTTP server, as separate scopes:
 *
 *   (all)       redirect from previous dashboard hosts
 *   /healthz    /readyz          no auth
 *   /v1/…       CI API           project token
 *   /api/…, /…  dashboard        dashboard password
 *
 * Each scope's hooks and error handler apply only inside it.
 */
export function buildServer(options: ServerOptions): FastifyInstance {
  const app = Fastify({ loggerInstance: options.logger, trustProxy: true })

  if (options.previousHosts?.length && options.publicOrigin) {
    app.addHook('onRequest', redirectPreviousHosts(options.previousHosts, options.publicOrigin))
  }
  void app.register(healthRoutes, {
    checks: options.checks,
    ...(options.checkTimeoutMs ? { checkTimeoutMs: options.checkTimeoutMs } : {}),
  })
  if (options.api) void app.register(v1Routes, { ...options.api, prefix: '/v1' })
  if (options.dashboard) void app.register(dashboardRoutes, options.dashboard)

  return app
}
