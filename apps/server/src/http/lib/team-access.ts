import { findTeamForMember, getTeamMemberRole } from '@circi/db'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'

import { currentUser } from '#http/hooks/session.ts'

import type { Deps } from './deps.ts'
import { parse } from './validation.ts'

const teamParams = z.object({ workspace: z.string(), team: z.string() })

/**
 * The team a dashboard request names, if the signed-in user belongs to its workspace;
 * anyone else gets "not found", as for a team that doesn't exist. With `manage`, members who
 * are not owners or admins get 403. Replies itself when it returns undefined.
 */
export async function loadTeam(
  deps: Pick<Deps.Dashboard, 'db'>,
  req: FastifyRequest,
  reply: FastifyReply,
  options: { manage?: boolean } = {},
) {
  const p = parse(teamParams, req.params)
  const user = currentUser(req)
  const team = await findTeamForMember(deps.db, {
    workspaceSlug: p.workspace,
    teamSlug: p.team,
    userId: user.id,
    method: user.method,
  })
  if (!team) {
    await reply.code(404).send({ error: 'Team not found' })
    return undefined
  }
  if (options.manage) {
    const role = await getTeamMemberRole(deps.db, team.id, user.id)
    if (role !== 'owner' && role !== 'admin') {
      await reply.code(403).send({ error: 'Only owners and admins can change this' })
      return undefined
    }
  }
  return { team, user }
}
