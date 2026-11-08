import {
  getMemberRole,
  getWorkspaceBySlug,
  getWorkspaceSettings,
  NotFoundError,
  workspaceAcceptsSession,
  setWorkspaceSettings,
} from '@circi/db'
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'

import { currentUser } from '#http/hooks/session.ts'
import type { Deps } from '#http/lib/deps.ts'
import { parse } from '#http/lib/validation.ts'

const params = z.object({ workspace: z.string() })
const body = z.object({ flakyBlocksMerge: z.boolean() }).partial().strict()

/**
 * A workspace's defaults for its teams. Members can see them, owners and admins change
 * them; anyone outside the workspace gets "not found".
 */
export const dashboardWorkspaceSettingsRoutes: FastifyPluginAsync<Deps.Dashboard> = async (
  app,
  deps,
) => {
  async function load(req: FastifyRequest, reply: FastifyReply) {
    const { workspace: slug } = parse(params, req.params)
    const user = currentUser(req)
    const workspace = await getWorkspaceBySlug(deps.db, slug).catch((err: unknown) => {
      if (err instanceof NotFoundError) return undefined
      throw err
    })
    const role = workspace
      ? await getMemberRole(deps.db, { userId: user.id, workspaceId: workspace.id })
      : undefined
    if (
      !workspace ||
      !role ||
      !(await workspaceAcceptsSession(deps.db, workspace.id, user.method))
    ) {
      await reply.code(404).send({ error: 'Workspace not found' })
      return undefined
    }
    return { workspace, canManage: role === 'owner' || role === 'admin' }
  }

  app.get('/workspaces/:workspace/settings', async (req, reply) => {
    const found = await load(req, reply)
    if (!found) return reply
    return {
      canManage: found.canManage,
      settings: await getWorkspaceSettings(deps.db, found.workspace.id),
    }
  })

  app.patch('/workspaces/:workspace/settings', async (req, reply) => {
    const found = await load(req, reply)
    if (!found) return reply
    if (!found.canManage) {
      return reply.code(403).send({ error: 'Only owners and admins can change workspace settings' })
    }
    const patch = parse(body, req.body)
    return { settings: await setWorkspaceSettings(deps.db, found.workspace.id, patch) }
  })
}
