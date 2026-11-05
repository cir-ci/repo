import { type Auth, fromNodeHeaders } from '@circi/auth'
import type { FastifyRequest, onRequestAsyncHookHandler } from 'fastify'

/**
 * Dashboard authentication: the better-auth session cookie. A valid session puts the user on
 * `req.user`; otherwise the request is a 401 and the web app shows its sign-in page.
 */
export function requireSession(auth: Auth): onRequestAsyncHookHandler {
  return async (req, reply) => {
    const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) })
    if (!session) return reply.code(401).send({ error: 'Sign in to continue' })
    req.user = { id: session.user.id, email: session.user.email, name: session.user.name }
    return undefined
  }
}

/** The signed-in user, inside a scope protected by `requireSession`. */
export function currentUser(req: FastifyRequest): { id: string; email: string; name: string } {
  if (!req.user) throw new Error('unauthenticated request reached a handler')
  return req.user
}
