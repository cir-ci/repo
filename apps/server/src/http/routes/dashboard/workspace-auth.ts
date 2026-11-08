import {
  getMemberRole,
  getWorkspaceBySlug,
  getWorkspaceAuthSettings,
  instanceAuthMethods,
  NotFoundError,
  workspaceAcceptsSession,
  setWorkspaceAuthSettings,
} from '@circi/db'
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'

import { currentUser } from '#http/hooks/session.ts'
import type { Deps } from '#http/lib/deps.ts'
import { parse } from '#http/lib/validation.ts'

const params = z.object({ workspace: z.string() })
const body = z
  .object({
    emailLoginEnabled: z.boolean(),
    passwordLoginEnabled: z.boolean(),
    signinGithub: z.boolean(),
    signinGoogle: z.boolean(),
  })
  .partial()
  .strict()

/**
 * A workspace's login-method switches (PLAN §7.8). Members can see them, owners and admins
 * change them, and a change that would lock every owner out is refused.
 */
export const dashboardWorkspaceAuthRoutes: FastifyPluginAsync<Deps.Dashboard> = async (
  app,
  deps,
) => {
  const instance = instanceAuthMethods({
    password: deps.passwordLogin !== false,
    email: deps.emailLogin === true,
    providers: (deps.sso ?? []).map((p) => p.id),
  })

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

  app.get('/workspaces/:workspace/auth', async (req, reply) => {
    const found = await load(req, reply)
    if (!found) return reply
    return {
      canManage: found.canManage,
      settings: await getWorkspaceAuthSettings(deps.db, found.workspace.id),
      instance,
    }
  })

  app.patch('/workspaces/:workspace/auth', async (req, reply) => {
    const found = await load(req, reply)
    if (!found) return reply
    if (!found.canManage) {
      return reply.code(403).send({ error: 'Only owners and admins can change sign-in methods' })
    }
    const patch = parse(body, req.body)
    return {
      settings: await setWorkspaceAuthSettings(deps.db, found.workspace.id, patch, { instance }),
    }
  })
}
