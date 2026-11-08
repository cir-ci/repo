import type { Auth } from '@circi/auth'
import { verifyTeamToken } from '@circi/auth'
import type { Database, getTeamContext } from '@circi/db'
import type { FastifyRequest, onRequestAsyncHookHandler } from 'fastify'

/**
 * `/v1` authentication: a team CI token as `Authorization: Bearer circi_…`, checked by
 * better-auth's API key plugin. The matching team goes on `req.team`; anything else is a
 * 401 before any handler runs.
 */
export function requireTeamToken(auth: Auth, db: Database): onRequestAsyncHookHandler {
  return async (req, reply) => {
    const header = req.headers.authorization
    const token = header?.startsWith('Bearer ') ? header.slice(7).trim() : undefined
    const team = token ? await verifyTeamToken(auth, db, token) : undefined
    if (!team) {
      return reply
        .code(401)
        .header('www-authenticate', 'Bearer')
        .send({ error: 'A valid team token is required (Authorization: Bearer circi_…)' })
    }
    req.team = team
    return undefined
  }
}

/** The authenticated team, inside a scope protected by `requireTeamToken`. */
export function currentTeam(req: FastifyRequest): getTeamContext.Context {
  if (!req.team) throw new Error('unauthenticated request reached a handler')
  return req.team
}
