import {
  getMemberRole,
  getOrganizationBySlug,
  getOrgAuthSettings,
  type InstanceMethods,
  NotFoundError,
  orgAcceptsSession,
  setOrgAuthSettings,
} from '@circi/db'
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'

import type { DashboardDeps } from '../../deps.ts'
import { currentUser } from '../../hooks/session.ts'
import { parse } from '../../validation.ts'

const params = z.object({ org: z.string() })
const body = z
  .object({ emailLoginEnabled: z.boolean(), passwordLoginEnabled: z.boolean() })
  .partial()
  .strict()

/**
 * An organization's login-method switches (PLAN §7.8). Members can see them, owners and admins
 * change them, and a change that would lock every owner out is refused.
 */
export const dashboardOrgAuthRoutes: FastifyPluginAsync<DashboardDeps> = async (app, deps) => {
  const instance: InstanceMethods = {
    password: deps.passwordLogin !== false,
    email: deps.emailLogin === true,
    oidc: (deps.sso?.length ?? 0) > 0,
  }

  async function load(req: FastifyRequest, reply: FastifyReply) {
    const { org: slug } = parse(params, req.params)
    const user = currentUser(req)
    const org = await getOrganizationBySlug(deps.db, slug).catch((err: unknown) => {
      if (err instanceof NotFoundError) return undefined
      throw err
    })
    const role = org
      ? await getMemberRole(deps.db, { userId: user.id, organizationId: org.id })
      : undefined
    if (!org || !role || !(await orgAcceptsSession(deps.db, org.id, user.method))) {
      await reply.code(404).send({ error: 'Organization not found' })
      return undefined
    }
    return { org, canManage: role === 'owner' || role === 'admin' }
  }

  app.get('/organizations/:org/auth', async (req, reply) => {
    const found = await load(req, reply)
    if (!found) return reply
    return {
      canManage: found.canManage,
      settings: await getOrgAuthSettings(deps.db, found.org.id),
      instance,
    }
  })

  app.patch('/organizations/:org/auth', async (req, reply) => {
    const found = await load(req, reply)
    if (!found) return reply
    if (!found.canManage) {
      return reply.code(403).send({ error: 'Only owners and admins can change sign-in methods' })
    }
    const patch = parse(body, req.body)
    return {
      settings: await setOrgAuthSettings(deps.db, found.org.id, patch, { instance }),
    }
  })
}
