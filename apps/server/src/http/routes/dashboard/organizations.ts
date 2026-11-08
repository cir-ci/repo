import { createOrganization, createProjectWithToken } from '@circi/auth'
import {
  getMemberRole,
  orgAcceptsSession,
  type SessionMethod,
  listManageableOrganizations,
  listRefusingOrganizations,
  getOrganizationBySlug,
  isInstanceAdmin,
  NotFoundError,
} from '@circi/db'
import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'

import { currentUser } from '#http/hooks/session.ts'
import type { DashboardDeps } from '#http/lib/deps.ts'
import { parse } from '#http/lib/validation.ts'

const nameBody = z.object({ name: z.string().min(1).max(100) })
const orgParams = z.object({ org: z.string() })

/**
 * Creating organizations and projects from the dashboard. Organizations: instance admins, or
 * any member when `ORG_CREATION=anyone`. Projects: owners and admins of the organization, who
 * get the project's CI token once, in the response.
 */
export const dashboardOrganizationRoutes: FastifyPluginAsync<DashboardDeps> = async (app, deps) => {
  async function canCreateOrganization(user: {
    id: string
    method: SessionMethod
  }): Promise<boolean> {
    // Someone signed in through an organization's own provider belongs to that organization only.
    if (typeof user.method === 'object') return false
    return deps.orgCreation === 'anyone' || (await isInstanceAdmin(deps.db, user.id))
  }

  app.get('/capabilities', async (req) => ({
    canCreateOrganization: await canCreateOrganization(currentUser(req)),
    /** Organizations that refuse the way this session signed in, and what they accept. */
    refusingOrganizations: await listRefusingOrganizations(
      deps.db,
      currentUser(req).id,
      currentUser(req).method,
    ),
    /** Where this person may create projects. */
    manageableOrganizations: await listManageableOrganizations(
      deps.db,
      currentUser(req).id,
      currentUser(req).method,
    ),
  }))

  app.post('/organizations', async (req, reply) => {
    const user = currentUser(req)
    if (!(await canCreateOrganization(user))) {
      return reply.code(403).send({ error: 'Only instance admins can create organizations here' })
    }
    const { name } = parse(nameBody, req.body)
    const org = await createOrganization(deps.auth, deps.db, { name, ownerEmail: user.email })
    return reply.code(201).send({ organization: { slug: org.slug, name: org.name } })
  })

  app.post('/organizations/:org/projects', async (req, reply) => {
    const { org: orgSlug } = parse(orgParams, req.params)
    const { name } = parse(nameBody, req.body)
    const org = await getOrganizationBySlug(deps.db, orgSlug).catch((err: unknown) => {
      if (err instanceof NotFoundError) return undefined
      throw err
    })
    const refused = org
      ? !(await orgAcceptsSession(deps.db, org.id, currentUser(req).method))
      : false
    const role =
      org && !refused
        ? await getMemberRole(deps.db, { userId: currentUser(req).id, organizationId: org.id })
        : undefined
    if (!org || !role) return reply.code(404).send({ error: 'Organization not found' })
    if (role !== 'owner' && role !== 'admin') {
      return reply.code(403).send({ error: 'Only owners and admins can create projects' })
    }
    const { project, token } = await createProjectWithToken(deps.auth, deps.db, { orgSlug, name })
    return reply.code(201).send({ project: { slug: project.slug, name: project.name }, token })
  })
}
