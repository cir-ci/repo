import { findProjectForMember, getProjectMemberRole } from '@circi/db'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'

import { currentUser } from '../hooks/session.ts'
import type { DashboardDeps } from './deps.ts'
import { parse } from './validation.ts'

const projectParams = z.object({ org: z.string(), project: z.string() })

/**
 * The project a dashboard request names, if the signed-in user belongs to its organization;
 * anyone else gets "not found", as for a project that doesn't exist. With `manage`, members who
 * are not owners or admins get 403. Replies itself when it returns undefined.
 */
export async function loadProject(
  deps: Pick<DashboardDeps, 'db'>,
  req: FastifyRequest,
  reply: FastifyReply,
  options: { manage?: boolean } = {},
) {
  const p = parse(projectParams, req.params)
  const user = currentUser(req)
  const project = await findProjectForMember(deps.db, {
    orgSlug: p.org,
    projectSlug: p.project,
    userId: user.id,
    method: user.method,
  })
  if (!project) {
    await reply.code(404).send({ error: 'Project not found' })
    return undefined
  }
  if (options.manage) {
    const role = await getProjectMemberRole(deps.db, project.id, user.id)
    if (role !== 'owner' && role !== 'admin') {
      await reply.code(403).send({ error: 'Only owners and admins can change this' })
      return undefined
    }
  }
  return { project, user }
}
