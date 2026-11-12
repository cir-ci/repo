import type { onRequestAsyncHookHandler } from 'fastify'

import { currentUser } from './session.ts'

/**
 * Only instance admins pass (403 otherwise). Add it after `requireSession`, which answers
 * the signed-out with 401 first and looks the role up with the session.
 */
export function requireInstanceAdmin(): onRequestAsyncHookHandler {
  return async (req, reply) => {
    if (!currentUser(req).instanceAdmin) {
      return reply.code(403).send({ error: 'Only instance admins can do this' })
    }
    return undefined
  }
}
