import type { Auth } from '@circi/auth'
import { verifyProjectToken } from '@circi/auth'
import type { Database, getProjectContext } from '@circi/db'
import type { FastifyRequest, onRequestAsyncHookHandler } from 'fastify'

/**
 * `/v1` authentication: a project CI token as `Authorization: Bearer circi_…`, checked by
 * better-auth's API key plugin. The matching project goes on `req.project`; anything else is a
 * 401 before any handler runs.
 */
export function requireProjectToken(auth: Auth, db: Database): onRequestAsyncHookHandler {
  return async (req, reply) => {
    const header = req.headers.authorization
    const token = header?.startsWith('Bearer ') ? header.slice(7).trim() : undefined
    const project = token ? await verifyProjectToken(auth, db, token) : undefined
    if (!project) {
      return reply
        .code(401)
        .header('www-authenticate', 'Bearer')
        .send({ error: 'A valid project token is required (Authorization: Bearer circi_…)' })
    }
    req.project = project
    return undefined
  }
}

/** The authenticated project, inside a scope protected by `requireProjectToken`. */
export function currentProject(req: FastifyRequest): getProjectContext.Context {
  if (!req.project) throw new Error('unauthenticated request reached a handler')
  return req.project
}
