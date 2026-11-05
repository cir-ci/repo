import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify'

import type { DashboardDeps, V1Deps } from './deps.ts'
import { redirectPreviousHosts } from './hooks/previous-hosts.ts'
import { dashboardRoutes } from './routes/dashboard/index.ts'
import { githubWebhookRoutes, type GithubWebhookDeps } from './routes/github-webhook.ts'
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
  /** GitHub App webhooks (`/webhooks/github`). Omitted when no GitHub App is configured. */
  githubWebhook?: GithubWebhookDeps
  /** Dashboard (`/api`, `/`). Omitted in tests that don't need it. */
  dashboard?: DashboardDeps
}

/**
 * The HTTP server, as separate scopes:
 *
 *   (all)       redirect from previous dashboard hosts
 *   /healthz    /readyz          no auth
 *   /v1/…       CI API           project token
 *   /webhooks/github  GitHub App   signature
 *   /api/auth/… sign-in          public (better-auth)
 *   /api/…      dashboard API    session cookie
 *   /…          web app          public static files
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
  // Each scope is registered inside a wrapper that carries its `prefix`, so the plugin itself
  // receives only its dependencies and can pass them straight on to its routes.
  const { api } = options
  if (api) {
    void app.register(
      async (scope) => {
        await scope.register(v1Routes, api)
      },
      { prefix: '/v1' },
    )
  }
  if (options.githubWebhook) void app.register(githubWebhookRoutes, options.githubWebhook)
  if (options.dashboard) void app.register(dashboardRoutes, options.dashboard)

  return app
}
