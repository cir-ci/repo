import type { Team } from '@circi/api'
import { listTeamMembers } from '@circi/db/queries'
import { addMembersToTeam, removeMemberFromTeam } from '@circi/services'
import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'

import type { Deps } from '#http/lib/deps.ts'
import { loadTeam } from '#http/lib/team-access.ts'
import { parse } from '#http/lib/validation.ts'

import { teamParams } from './schemas.ts'

const addBody = z.object({ userIds: z.array(z.string().min(1).max(200)).max(500) }).strict()
const memberParams = teamParams.extend({ userId: z.string().min(1).max(200) })

/**
 * A team's people. Everyone who can see the team reads the list; owners and admins add people
 * and remove anyone; a member can remove only themselves (leave). Roles stay workspace-wide.
 */
export const dashboardTeamMemberRoutes: FastifyPluginAsync<Deps.Dashboard> = async (app, deps) => {
  async function list(teamId: string, canManage: boolean): Promise<Team.MemberList> {
    const members = await listTeamMembers(deps.db, teamId)
    return {
      members: members.map((m) => Object.assign({}, m, { addedAt: m.addedAt.toISOString() })),
      canManage,
    }
  }

  app.get('/teams/:workspace/:team/members', async (req): Promise<Team.MemberList> => {
    const found = await loadTeam(deps, req)
    return list(found.team.id, found.canManage)
  })

  app.post('/teams/:workspace/:team/members', async (req): Promise<Team.MemberList> => {
    const found = await loadTeam(deps, req)
    const { userIds } = parse(addBody, req.body)
    await addMembersToTeam(deps.db, {
      actor: {
        userId: found.user.id,
        instanceAdmin: false,
        role: found.role,
        teamMember: found.isMember,
      },
      teamId: found.team.id,
      userIds,
    })
    return list(found.team.id, found.canManage)
  })

  app.delete('/teams/:workspace/:team/members/:userId', async (req, reply) => {
    const found = await loadTeam(deps, req)
    const { userId } = parse(memberParams, req.params)
    await removeMemberFromTeam(deps.db, {
      actor: {
        userId: found.user.id,
        instanceAdmin: false,
        role: found.role,
        teamMember: found.isMember,
      },
      teamId: found.team.id,
      userId,
    })
    return reply.code(204).send()
  })
}
