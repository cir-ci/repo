import { type Auth, fromNodeHeaders } from '@circi/auth'
import {
  type Database,
  findWorkspaceBySlug,
  getMemberRole,
  getSessionMethod,
  isInstanceAdmin,
  providerRefusal,
} from '@circi/db'
import type { FastifyRequest, onRequestAsyncHookHandler, preHandlerAsyncHookHandler } from 'fastify'

/**
 * Dashboard authentication: the better-auth session cookie. A valid session puts the user on
 * `req.user`; otherwise the request is a 401 and the web app shows its sign-in page.
 */
export function requireSession(auth: Auth, db: Database): onRequestAsyncHookHandler {
  return async (req, reply) => {
    const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) })
    if (!session) return reply.code(401).send({ error: 'Sign in to continue' })
    // Workspaces may refuse some login methods, so the session's method travels with it.
    let method = (await getSessionMethod(db, session.session.id)) ?? 'unknown'
    // Instance admins are never locked out by a workspace's GitHub or Google switch.
    if (
      typeof method === 'object' &&
      'oidcProvider' in method &&
      (await isInstanceAdmin(db, session.user.id))
    ) {
      method = 'oidc'
    }
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

/**
 * A member whose session signed in through GitHub or Google gets 403, with the reason, on the
 * routes of a workspace that switched that provider off. (Lists that span workspaces, such as
 * the sidebar, simply leave such a workspace out: see `workspaceAccepts`.) Add it after
 * `requireSession`.
 */
export function refuseBlockedProvider(db: Database): preHandlerAsyncHookHandler {
  return async (req, reply) => {
    const { user } = req
    const params: unknown = req.params
    const slug =
      typeof params === 'object' && params !== null ? Reflect.get(params, 'workspace') : undefined
    if (!user || typeof slug !== 'string') return undefined
    if (typeof user.method !== 'object' || !('oidcProvider' in user.method)) return undefined
    const found = await findWorkspaceBySlug(db, slug)
    if (!found) return undefined
    // Anyone who is not a member just gets the route's own "not found".
    if ((await getMemberRole(db, { userId: user.id, workspaceId: found.id })) === undefined) {
      return undefined
    }
    const message = await providerRefusal(db, { workspaceId: found.id, method: user.method })
    return message ? reply.code(403).send({ error: message }) : undefined
  }
}
