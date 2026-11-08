import { type Database, isInstanceAdmin } from '@circi/db'
import type { onRequestAsyncHookHandler } from 'fastify'

import { currentUser } from './session.ts'

/**
 * Only instance admins pass (403 otherwise). Add it after `requireSession`, which answers
 * the signed-out with 401 first.
 */
export function requireInstanceAdmin(db: Database): onRequestAsyncHookHandler {
  return async (req, reply) => {
    if (!(await isInstanceAdmin(db, currentUser(req).id))) {
      return reply.code(403).send({ error: 'Only instance admins can do this' })
    }
    return undefined
  }
}
