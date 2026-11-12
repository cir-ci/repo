import { getWorkspaceAuthSettings, instanceAuthMethods } from '@circi/db/queries'
import { updateWorkspaceSignIn } from '@circi/services'
import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'

import { currentUser } from '#http/hooks/session.ts'
import type { Deps } from '#http/lib/deps.ts'
import { signInMethods } from '#http/lib/instance-config.ts'
import { parse } from '#http/lib/validation.ts'
import { loadWorkspace } from '#http/lib/workspace-access.ts'

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
  const instanceNow = async () => {
    const methods = await signInMethods(deps)
    return instanceAuthMethods({
      password: methods.password,
      email: methods.email,
      providers: methods.sso.map((p) => p.id),
    })
  }

  app.get('/workspaces/:workspace/auth', async (req) => {
    const found = await loadWorkspace(deps, req)
    return {
      canManage: found.canManage,
      settings: await getWorkspaceAuthSettings(deps.db, found.workspace.id),
      instance: await instanceNow(),
    }
  })

  app.patch('/workspaces/:workspace/auth', async (req) => {
    const found = await loadWorkspace(deps, req, {
      manage: true,
      forbidden: 'Only owners and admins can change sign-in methods',
    })
    const patch = parse(body, req.body)
    return {
      settings: await updateWorkspaceSignIn(deps.db, found.workspace.id, patch, {
        instance: await instanceNow(),
        currentMethod: currentUser(req).method,
      }),
    }
  })
}
