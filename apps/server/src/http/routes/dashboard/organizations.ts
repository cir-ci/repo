import { createOrganization, createProjectWithToken } from '@circi/auth'
import {
  getMemberRole,
  listManageableOrganizations,
  getOrganizationBySlug,
  isInstanceAdmin,
  NotFoundError,
} from '@circi/db'
import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'

import type { DashboardDeps } from '../../deps.ts'
import { currentUser } from '../../hooks/session.ts'
import { parse } from '../../validation.ts'

const nameBody = z.object({ name: z.string().min(1).max(100) })
const orgParams = z.object({ org: z.string() })

/**
 * Creating organizations and projects from the dashboard. Organizations: instance admins, or
 * any member when `ORG_CREATION=anyone`. Projects: owners and admins of the organization, who
 * get the project's CI token once, in the response.
 */
export const dashboardOrganizationRoutes: FastifyPluginAsync<DashboardDeps> = async (app, deps) => {
  async function canCreateOrganization(userId: string): Promise<boolean> {
    return deps.orgCreation === 'anyone' || (await isInstanceAdmin(deps.db, userId))
  }

  app.get('/capabilities', async (req) => ({
    canCreateOrganization: await canCreateOrganization(currentUser(req).id),
    /** Where this person may create projects. */
    manageableOrganizations: await listManageableOrganizations(deps.db, currentUser(req).id),
  }))

  app.post('/organizations', async (req, reply) => {
    const user = currentUser(req)
    if (!(await canCreateOrganization(user.id))) {
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
    const role = org
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
