import type { Database } from '@circi/db'
import { isVerifiedCustomDomain } from '@circi/db/queries'
import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'

export namespace internalRoutes {
  export interface Options {
    db: Database
    /** Most questions answered per minute, over the whole instance. Default 300. */
    maxPerMinute?: number
  }
}

const WINDOW_MS = 60_000
const query = z.object({ domain: z.string().optional() })

/**
 * Routes for the reverse proxy, never for browsers. `GET /internal/tls-ask?domain=<host>` is
 * Caddy's `on_demand_tls { ask }` check: it answers 200 when the host is a verified custom domain
 * of a site and 404 for anything else, with an empty body either way, so a certificate is issued
 * only for domains a project proved are pointed here. It is no secret (a TLS handshake reveals the
 * same), but it is kept narrow: yes or no, nothing else; a request that came through a proxy
 * (it carries `X-Forwarded-For`: Caddy asks directly, the public does not reach it) is refused;
 * and the number of answers per minute is capped, so it can't be used to hammer the database.
 */
export const internalRoutes: FastifyPluginAsync<internalRoutes.Options> = async (app, options) => {
  const limit = options.maxPerMinute ?? 300
  let windowStart = 0
  let used = 0

  app.get('/internal/tls-ask', async (req, reply) => {
    if (req.headers['x-forwarded-for'] !== undefined || req.headers.forwarded !== undefined) {
      return reply.code(404).send()
    }
    const now = Date.now()
    if (now - windowStart >= WINDOW_MS) {
      windowStart = now
      used = 0
    }
    used += 1
    if (used > limit) return reply.code(429).header('retry-after', '60').send()

    const asked = query.safeParse(req.query)
    const domain = asked.success
      ? (asked.data.domain ?? '').trim().toLowerCase().replace(/\.$/, '')
      : ''
    if (domain.length < 4 || domain.length > 253 || !/^[a-z0-9.-]+$/.test(domain)) {
      return reply.code(404).send()
    }
    return reply.code((await isVerifiedCustomDomain(options.db, domain)) ? 200 : 404).send()
  })
}
