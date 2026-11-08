import type { FastifyPluginAsync } from 'fastify'

export namespace healthRoutes {
  export interface Check {
    name: string
    check(): Promise<void>
  }

  export interface Options {
    checks: healthRoutes.Check[]
    /** Per-check timeout for /readyz, so a hung dependency can't hang the probe. */
    checkTimeoutMs?: number
  }
}

/**
 * `/healthz` (liveness: the process serves) and `/readyz` (readiness: dependencies answer).
 * Both are polled every few seconds, so they don't log each request.
 */
export const healthRoutes: FastifyPluginAsync<healthRoutes.Options> = async (app, options) => {
  const timeout = options.checkTimeoutMs ?? 2_000

  app.get('/healthz', { logLevel: 'silent' }, async () => ({ status: 'ok' }))

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
