import { createWorkspace, createTeamWithToken } from '@circi/auth'
import {
  getMemberRole,
  workspaceAcceptsSession,
  type SessionMethod,
  listManageableWorkspaces,
  listRefusingWorkspaces,
  getWorkspaceBySlug,
  isInstanceAdmin,
  NotFoundError,
} from '@circi/db'
import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'

import { currentUser } from '#http/hooks/session.ts'
import type { Deps } from '#http/lib/deps.ts'
import { parse } from '#http/lib/validation.ts'

const nameBody = z.object({ name: z.string().min(1).max(100) })
const workspaceParams = z.object({ workspace: z.string() })

/**
 * Creating workspaces and teams from the dashboard. Workspaces: instance admins, or
 * any member when `WORKSPACE_CREATION=anyone`. Teams: owners and admins of the workspace, who
 * get the team's CI token once, in the response.
 */
export const dashboardWorkspaceRoutes: FastifyPluginAsync<Deps.Dashboard> = async (app, deps) => {
  async function canCreateWorkspace(user: { id: string; method: SessionMethod }): Promise<boolean> {
    // Someone signed in through a workspace's own provider belongs to that workspace only.
    if (typeof user.method === 'object') return false
    return deps.workspaceCreation === 'anyone' || (await isInstanceAdmin(deps.db, user.id))
  }

  app.get('/capabilities', async (req) => ({
    canCreateWorkspace: await canCreateWorkspace(currentUser(req)),
    /** Workspaces that refuse the way this session signed in, and what they accept. */
    refusingWorkspaces: await listRefusingWorkspaces(
      deps.db,
      currentUser(req).id,
      currentUser(req).method,
    ),
    /** Where this person may create teams. */
    manageableWorkspaces: await listManageableWorkspaces(
      deps.db,
      currentUser(req).id,
      currentUser(req).method,
    ),
  }))

  app.post('/workspaces', async (req, reply) => {
    const user = currentUser(req)
    if (!(await canCreateWorkspace(user))) {
      return reply.code(403).send({ error: 'Only instance admins can create workspaces here' })
    }
    const { name } = parse(nameBody, req.body)
    const workspace = await createWorkspace(deps.auth, deps.db, { name, ownerEmail: user.email })
    return reply.code(201).send({ workspace: { slug: workspace.slug, name: workspace.name } })
  })

  app.post('/workspaces/:workspace/teams', async (req, reply) => {
    const { workspace: workspaceSlug } = parse(workspaceParams, req.params)
    const { name } = parse(nameBody, req.body)
    const workspace = await getWorkspaceBySlug(deps.db, workspaceSlug).catch((err: unknown) => {
      if (err instanceof NotFoundError) return undefined
      throw err
    })
    const refused = workspace
      ? !(await workspaceAcceptsSession(deps.db, workspace.id, currentUser(req).method))
      : false
    const role =
      workspace && !refused
        ? await getMemberRole(deps.db, { userId: currentUser(req).id, workspaceId: workspace.id })
        : undefined
    if (!workspace || !role) return reply.code(404).send({ error: 'Workspace not found' })
    if (role !== 'owner' && role !== 'admin') {
      return reply.code(403).send({ error: 'Only owners and admins can create teams' })
    }
    const { team, token } = await createTeamWithToken(deps.auth, deps.db, { workspaceSlug, name })
    return reply.code(201).send({ team: { slug: team.slug, name: team.name }, token })
  })
}
