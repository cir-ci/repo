import { type Auth, fromNodeHeaders } from '@circi/auth'
import { type Database, getSessionMethod } from '@circi/db'
import type { FastifyRequest, onRequestAsyncHookHandler } from 'fastify'

/**
 * Dashboard authentication: the better-auth session cookie. A valid session puts the user on
 * `req.user`; otherwise the request is a 401 and the web app shows its sign-in page.
 */
export function requireSession(auth: Auth, db: Database): onRequestAsyncHookHandler {
  return async (req, reply) => {
    const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) })
    if (!session) return reply.code(401).send({ error: 'Sign in to continue' })
    // Organizations may refuse some login methods, so the session's method travels with it.
    const method = (await getSessionMethod(db, session.session.id)) ?? 'unknown'
    req.user = {
      id: session.user.id,
      email: session.user.email,
      name: session.user.name,
      method,
      sessionId: session.session.id,
    }
    return undefined
  }
}

/** The signed-in user, inside a scope protected by `requireSession`. */
export function currentUser(req: FastifyRequest): NonNullable<FastifyRequest['user']> {
  if (!req.user) throw new Error('unauthenticated request reached a handler')
  return req.user
}
