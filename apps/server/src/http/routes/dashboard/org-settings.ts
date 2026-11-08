import {
  getMemberRole,
  getOrganizationBySlug,
  getOrgSettings,
  NotFoundError,
  orgAcceptsSession,
  setOrgSettings,
} from '@circi/db'
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'

import { currentUser } from '#http/hooks/session.ts'
import type { Deps } from '#http/lib/deps.ts'
import { parse } from '#http/lib/validation.ts'

const params = z.object({ org: z.string() })
const body = z.object({ flakyBlocksMerge: z.boolean() }).partial().strict()

/**
 * An organization's defaults for its projects. Members can see them, owners and admins change
 * them; anyone outside the organization gets "not found".
 */
export const dashboardOrgSettingsRoutes: FastifyPluginAsync<Deps.Dashboard> = async (app, deps) => {
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

  app.get('/organizations/:org/settings', async (req, reply) => {
    const found = await load(req, reply)
    if (!found) return reply
    return { canManage: found.canManage, settings: await getOrgSettings(deps.db, found.org.id) }
  })

  app.patch('/organizations/:org/settings', async (req, reply) => {
    const found = await load(req, reply)
    if (!found) return reply
    if (!found.canManage) {
      return reply
        .code(403)
        .send({ error: 'Only owners and admins can change organization settings' })
    }
    const patch = parse(body, req.body)
    return { settings: await setOrgSettings(deps.db, found.org.id, patch) }
  })
}
