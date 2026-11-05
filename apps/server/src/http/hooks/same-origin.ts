import type { onRequestHookHandler } from 'fastify'

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

/**
 * CSRF protection for the dashboard API (PLAN §7.6): a request that changes something must come
 * from the dashboard's own origin. Browsers always send `Origin` on such requests, so a page on
 * any other site, such as a hosted Storybook, can't make a signed-in user's browser do it, even
 * though it carries their cookie. Requests with no `Origin` and no `Sec-Fetch-Site` come from
 * tools like curl, not from a browser acting for someone, and pass.
 */
export function requireSameOrigin(origin: string): onRequestHookHandler {
  return (req, reply, done) => {
    if (SAFE_METHODS.has(req.method)) return done()
    const given = req.headers.origin
    const site = req.headers['sec-fetch-site']
    const allowed =
      given !== undefined
        ? given === origin
        : site === undefined || site === 'same-origin' || site === 'none'
    if (allowed) return done()
    void reply.code(403).send({ error: 'This request must come from the CirCI dashboard itself' })
    return undefined
  }
}
