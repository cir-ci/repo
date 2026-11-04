import { createHash, timingSafeEqual } from 'node:crypto'

import type { FastifyRequest, onRequestAsyncHookHandler } from 'fastify'

import { isApiPath, noticePage } from '../pages.ts'

/**
 * Interim dashboard protection until accounts arrive in M2: HTTP basic auth with
 * DASHBOARD_PASSWORD (any username). Without a password the dashboard is off, and says so.
 */
export function requireDashboardPassword(password: string | undefined): onRequestAsyncHookHandler {
  return async (req, reply) => {
    if (!password) {
      const html = wantsHtml(req)
      return reply
        .code(503)
        .type(html ? 'text/html; charset=utf-8' : 'application/json')
        .send(
          html
            ? noticePage(
                'Dashboard is off',
                'Set <code>DASHBOARD_PASSWORD</code> (12+ characters) to turn it on. It is a stand-in until CirCI has user accounts.',
              )
            : { error: 'The dashboard is off: set DASHBOARD_PASSWORD to turn it on' },
        )
    }
    if (!checkBasicAuth(req.headers.authorization, password)) {
      return reply
        .code(401)
        .header('www-authenticate', 'Basic realm="CirCI", charset="UTF-8"')
        .send({ error: 'Sign in with the dashboard password' })
    }
    return undefined
  }
}

/** Basic auth with any username; the password is compared in constant time via its digest. */
export function checkBasicAuth(header: string | undefined, password: string): boolean {
  if (!header?.startsWith('Basic ')) return false
  const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8')
  const colon = decoded.indexOf(':')
  if (colon < 0) return false
  const given = createHash('sha256')
    .update(decoded.slice(colon + 1))
    .digest()
  const expected = createHash('sha256').update(password).digest()
  return timingSafeEqual(given, expected)
}

function wantsHtml(req: FastifyRequest): boolean {
  return !isApiPath(req.url) && (req.headers.accept ?? '').includes('text/html')
}
