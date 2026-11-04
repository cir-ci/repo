import {
  findProjectBySlugs,
  getBuildDetail,
  listBuildsForProject,
  listProjectsOverview,
} from '@circi/db'
import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'

import type { DashboardDeps } from '../../deps.ts'
import { parse } from '../../validation.ts'

const projectParams = z.object({ org: z.string(), project: z.string() })
const buildParams = projectParams.extend({ number: z.string() })
const buildsQuery = z.object({ before: z.string().optional() })

/** Builds list page size; the web app shows "Older builds" when a page is full. */
const PAGE_SIZE = 50

/** Projects, a project's builds, and one build in detail, shaped for the web app. */
export const dashboardProjectRoutes: FastifyPluginAsync<DashboardDeps> = async (app, deps) => {
  app.get('/projects', async () => ({ projects: await listProjectsOverview(deps.db) }))

  app.get('/projects/:org/:project', async (req, reply) => {
    const params = parse(projectParams, req.params)
    const project = await findProjectBySlugs(deps.db, params.org, params.project)
    if (!project) return reply.code(404).send({ error: 'Project not found' })
    const before = Number(parse(buildsQuery, req.query).before)
    const builds = await listBuildsForProject(deps.db, project.id, {
      limit: PAGE_SIZE,
      ...(Number.isInteger(before) && before > 0 ? { beforeNumber: before } : {}),
    })
    return { project, builds }
  })

  app.get('/projects/:org/:project/builds/:number', async (req, reply) => {
    const params = parse(buildParams, req.params)
    const project = await findProjectBySlugs(deps.db, params.org, params.project)
    const number = Number(params.number)
    if (!project || !Number.isInteger(number))
      return reply.code(404).send({ error: 'Build not found' })
    const detail = await getBuildDetail(deps.db, project.id, number)
    if (!detail) return reply.code(404).send({ error: 'Build not found' })
    return { project, ...detail }
  })
}
