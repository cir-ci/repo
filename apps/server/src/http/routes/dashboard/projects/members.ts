import type { Project } from '@circi/api'
import { listProjectMembers } from '@circi/db/queries'
import { addMembersToProject, removeMemberFromProject } from '@circi/services'
import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'

import type { Deps } from '#http/lib/deps.ts'
import { loadProject } from '#http/lib/project-access.ts'
import { parse } from '#http/lib/validation.ts'

import { projectParams } from './schemas.ts'

const addBody = z.object({ userIds: z.array(z.string().min(1).max(200)).max(500) }).strict()
const memberParams = projectParams.extend({ userId: z.string().min(1).max(200) })

/**
 * A project's people. Everyone who can see the project reads the list; owners and admins add people
 * and remove anyone; a member can remove only themselves (leave). Roles stay workspace-wide.
 */
export const dashboardProjectMemberRoutes: FastifyPluginAsync<Deps.Dashboard> = async (
  app,
  deps,
) => {
  async function list(projectId: string, canManage: boolean): Promise<Project.MemberList> {
    const members = await listProjectMembers(deps.db, projectId)
    return {
      members: members.map((m) => Object.assign({}, m, { addedAt: m.addedAt.toISOString() })),
      canManage,
    }
  }

  app.get('/projects/:workspace/:project/members', async (req): Promise<Project.MemberList> => {
    const found = await loadProject(deps, req)
    return list(found.project.id, found.canManage)
  })

  app.post('/projects/:workspace/:project/members', async (req): Promise<Project.MemberList> => {
    const found = await loadProject(deps, req)
    const { userIds } = parse(addBody, req.body)
    await addMembersToProject(deps.db, {
      actor: {
        userId: found.user.id,
        instanceAdmin: false,
        role: found.role,
        projectMember: found.isMember,
      },
      projectId: found.project.id,
      userIds,
    })
    return list(found.project.id, found.canManage)
  })

  app.delete('/projects/:workspace/:project/members/:userId', async (req, reply) => {
    const found = await loadProject(deps, req)
    const { userId } = parse(memberParams, req.params)
    await removeMemberFromProject(deps.db, {
      actor: {
        userId: found.user.id,
        instanceAdmin: false,
        role: found.role,
        projectMember: found.isMember,
      },
      projectId: found.project.id,
      userId,
    })
    return reply.code(204).send()
  })
}
