import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify'

export interface ReadinessCheck {
  name: string
  check(): Promise<void>
}

export interface ServerOptions {
  logger: FastifyBaseLogger
  checks: ReadinessCheck[]
  /** Per-check timeout for /readyz, so a hung dependency can't hang the probe. */
  checkTimeoutMs?: number
}

export function buildServer(options: ServerOptions): FastifyInstance {
  const app = Fastify({
    loggerInstance: options.logger,
    trustProxy: true,
  })
  const timeout = options.checkTimeoutMs ?? 2_000

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
