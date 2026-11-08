import {
  type BuildFilters,
  findProjectForMember,
  getBuildDetail,
  getProjectGitAttention,
  listBuildsForProject,
  listProjectsOverview,
} from '@circi/db'
import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'

import { currentUser } from '#http/hooks/session.ts'
import { buildFilterShape } from '#http/lib/build-filters.ts'
import type { DashboardDeps } from '#http/lib/deps.ts'
import { parse } from '#http/lib/validation.ts'

const projectParams = z.object({ org: z.string(), project: z.string() })
const buildParams = projectParams.extend({ number: z.string() })
const buildsQuery = z.object({
  before: z.string().optional(),
  ...buildFilterShape,
})

/** Builds list page size; the web app shows "Older builds" when a page is full. */
const PAGE_SIZE = 50

/**
 * Projects, a project's builds, and one build in detail, shaped for the web app. Everything is
 * limited to the signed-in user's organizations; a project in anyone else's is "not found".
 */
export const dashboardProjectRoutes: FastifyPluginAsync<DashboardDeps> = async (app, deps) => {
  app.get('/projects', async (req) => ({
    projects: await listProjectsOverview(deps.db, currentUser(req).id, currentUser(req).method),
  }))

  app.get('/projects/:org/:project', async (req, reply) => {
    const params = parse(projectParams, req.params)
    const project = await findProjectForMember(deps.db, {
      orgSlug: params.org,
      projectSlug: params.project,
      userId: currentUser(req).id,
      method: currentUser(req).method,
    })
    if (!project) return reply.code(404).send({ error: 'Project not found' })
    const q = parse(buildsQuery, req.query)
    const before = Number(q.before)
    const filters: BuildFilters = {
      ...(q.status ? { status: q.status } : {}),
      ...(q.review ? { reviewStatus: q.review } : {}),
      ...(q.branch ? { branch: q.branch } : {}),
      ...(q.author ? { author: q.author } : {}),
      ...(q.reviewer ? { reviewer: q.reviewer } : {}),
      ...(q.name ? { name: q.name } : {}),
      ...(q.from ? { from: new Date(q.from) } : {}),
      ...(q.to ? { to: new Date(q.to) } : {}),
    }
    const builds = await listBuildsForProject(deps.db, project.id, {
      limit: PAGE_SIZE,
      filters,
      ...(Number.isInteger(before) && before > 0 ? { beforeNumber: before } : {}),
    })
    const attention = await getProjectGitAttention(deps.db, project.id)
    return {
      project,
      builds,
      gitAttention: attention
        ? { reason: attention.reason, since: attention.since.toISOString() }
        : null,
    }
  })

  app.get('/projects/:org/:project/builds/:number', async (req, reply) => {
    const params = parse(buildParams, req.params)
    const project = await findProjectForMember(deps.db, {
      orgSlug: params.org,
      projectSlug: params.project,
      userId: currentUser(req).id,
      method: currentUser(req).method,
    })
    const number = Number(params.number)
    if (!project || !Number.isInteger(number))
      return reply.code(404).send({ error: 'Build not found' })
    const detail = await getBuildDetail(deps.db, project.id, number)
    if (!detail) return reply.code(404).send({ error: 'Build not found' })
    return { project, ...detail }
  })
}
