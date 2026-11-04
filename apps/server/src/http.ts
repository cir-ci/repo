import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify'

import { registerV1, type V1Deps } from './api/v1.ts'

export interface ReadinessCheck {
  name: string
  check(): Promise<void>
}

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
}

export function buildServer(options: ServerOptions): FastifyInstance {
  const app = Fastify({
    loggerInstance: options.logger,
    trustProxy: true,
  })
  const timeout = options.checkTimeoutMs ?? 2_000

  // After the dashboard moves (PUBLIC_URL changed), old links keep working: 308 keeps the
  // method and body, so API clients still pointed at the old host also follow it.
  const previousHosts = new Set(options.previousHosts?.map((h) => h.toLowerCase()) ?? [])
  if (previousHosts.size > 0 && options.publicOrigin) {
    const target = options.publicOrigin
    app.addHook('onRequest', (req, reply, done) => {
      if (previousHosts.has(req.host.toLowerCase())) {
        // Sending a reply ends the request; `done` must not be called as well.
        void reply.redirect(`${target}${req.url}`, 308)
        return
      }
      done()
    })
  }

  // Liveness: the process is up and serving. Never touches dependencies.
  // Both probes are polled every few seconds, so they don't log each request.
  app.get('/healthz', { logLevel: 'silent' }, async () => ({ status: 'ok' }))

  // Readiness: dependencies answer. Load balancers should route on this one.
  app.get('/readyz', { logLevel: 'silent' }, async (_req, reply) => {
    const results = await Promise.all(
      options.checks.map(async (c) => {
        try {
          await withTimeout(c.check(), timeout)
          return [c.name, 'ok'] as const
        } catch (err) {
          app.log.warn({ check: c.name, err }, 'readiness check failed')
          return [c.name, 'fail'] as const
        }
      }),
    )
    const ok = results.every(([, r]) => r === 'ok')
    return reply
      .code(ok ? 200 : 503)
      .send({ status: ok ? 'ok' : 'fail', checks: Object.fromEntries(results) })
  })

  if (options.api) registerV1(app, options.api)

  return app
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms)
    }),
  ]).finally(() => clearTimeout(timer))
}
