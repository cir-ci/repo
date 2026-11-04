import { hashToken, looksLikeProjectToken } from '@circi/core'
import {
  type Database,
  findProjectByTokenHash,
  getProjectContext,
  type ProjectContext,
} from '@circi/db'
import type { FastifyRequest, onRequestAsyncHookHandler } from 'fastify'

/**
 * `/v1` authentication: a project CI token as `Authorization: Bearer circi_…`. The matching
 * project goes on `req.project`; anything else is a 401 before any handler runs.
 */
export function requireProjectToken(db: Database): onRequestAsyncHookHandler {
  return async (req, reply) => {
    const project = await authenticate(db, req)
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
export function currentProject(req: FastifyRequest): ProjectContext {
  if (!req.project) throw new Error('unauthenticated request reached a handler')
  return req.project
}

async function authenticate(
  db: Database,
  req: FastifyRequest,
): Promise<ProjectContext | undefined> {
  const header = req.headers.authorization
  const token = header?.startsWith('Bearer ') ? header.slice(7).trim() : undefined
  if (!token || !looksLikeProjectToken(token)) return undefined
  const project = await findProjectByTokenHash(db, hashToken(token))
  return project ? getProjectContext(db, project.id) : undefined
}
