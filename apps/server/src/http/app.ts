import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify'

import { redirectPreviousHosts } from './hooks/previous-hosts.ts'
import type { Deps } from './lib/deps.ts'
import { argosRoutes } from './routes/argos/routes.ts'
import { dashboardRoutes } from './routes/dashboard/index.ts'
import { healthRoutes } from './routes/health.ts'
import { integrationWebhookRoutes } from './routes/integration-webhook.ts'
import { v1Routes } from './routes/v1/index.ts'
import { siteHostHook } from './sites/serve.ts'

export type { healthRoutes } from './routes/health.ts'

export namespace buildServer {
  export interface Options {
    logger: FastifyBaseLogger
    /**
     * Proxies whose `X-Forwarded-For` is believed (see `Config.trustedProxies`). Default: none, so
     * `request.ip` is the socket's remote address.
     */
    trustedProxies?: true | string[]
    checks: healthRoutes.Check[]
    /** Per-check timeout for /readyz, so a hung dependency can't hang the probe. */
    checkTimeoutMs?: number
    /** Current dashboard origin (`PUBLIC_URL`), e.g. `https://ci.acme.io`. */
    publicOrigin?: string
    /** Old dashboard hosts; requests to them are permanently redirected to `publicOrigin`. */
    previousHosts?: string[]
    /** CI upload API (`/v1`). Omitted in tests that only exercise health endpoints. */
    api?: Deps.V1
    /** Git host webhooks (`/api/integrations/:kind/webhook`, `/webhooks/:kind`), one route for every host. */
    gitWebhook?: integrationWebhookRoutes.Deps
    /** Static site hosting: requests for site addresses are answered before any route. */
    siteServing?: siteHostHook.Options
    /** Dashboard (`/api`, `/`). Omitted in tests that don't need it. */
    dashboard?: Deps.Dashboard
  }
}

/**
 * The HTTP server, as separate scopes:
 *
 *   (all)       redirect from previous dashboard hosts
 *   /healthz    /readyz          no auth
 *   /v1/…       CI API           team token
 *   /v2/…       Argos-compatible CI API   team token
 *   /webhooks/:kind   git hosts    signature or token (also /api/integrations/:kind/webhook)
 *   /api/auth/… sign-in          public (better-auth)
 *   /api/…      dashboard API    session cookie
 *   /…          web app          public static files
 *
 * Each scope's hooks and error handler apply only inside it.
 */
export function buildServer(options: buildServer.Options): FastifyInstance {
  const app = Fastify({
    loggerInstance: options.logger,
    trustProxy:
      options.trustedProxies === true
        ? true
        : (options.trustedProxies ?? []).length > 0
          ? options.trustedProxies
          : false,
    // Uploaded sites can stuff the cookie jar of the sites domain; accept the big headers that
    // result so the site handler can clear them (see `cleanupCookies`).
    http: { maxHeaderSize: 64 * 1024 },
  })
  // A replica that did not write an instance setting (the GitHub App) still notices it: the live
  // configuration is refreshed, at most once per its TTL, when a request arrives. Stale while
  // revalidating: the request never waits for the read (a slow or down database must not stall
  // /healthz), the next one sees the result.
  const refreshers = new Set(
    [options.gitWebhook?.integrations?.refresh, options.dashboard?.integrations?.refresh].filter(
      (r) => r !== undefined,
    ),
  )
  if (refreshers.size > 0) {
    app.addHook('onRequest', (_req, _reply, done) => {
      for (const refresh of refreshers) refresh().catch(() => {})
      done()
    })
  }
  if (options.siteServing) app.addHook('onRequest', siteHostHook(options.siteServing))

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
        await scope.register(argosRoutes, api)
      },
      { prefix: '/v2' },
    )
    void app.register(
      async (scope) => {
        await scope.register(v1Routes, api)
      },
      { prefix: '/v1' },
    )
  }
  if (options.gitWebhook) void app.register(integrationWebhookRoutes, options.gitWebhook)
  if (options.dashboard) void app.register(dashboardRoutes, options.dashboard)

  return app
}
