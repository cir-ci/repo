import type { Activity } from '@circi/api'
import { getBuildByNumber, listBuildActivity } from '@circi/db'
import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'

import type { DashboardDeps } from '../../lib/deps.ts'
import { loadProject } from '../../lib/project-access.ts'
import { parse } from '../../lib/validation.ts'

const params = z.object({ org: z.string(), project: z.string(), number: z.string() })

/** `GET …/builds/:number/activity`: what happened to a build, oldest first. Members only. */
export const dashboardActivityRoutes: FastifyPluginAsync<DashboardDeps> = async (app, deps) => {
  app.get('/projects/:org/:project/builds/:number/activity', async (req, reply) => {
    const access = await loadProject(deps, req, reply)
    if (!access) return reply
    const { project } = access
    const number = Number(parse(params, req.params).number)
    const build = Number.isInteger(number)
      ? await getBuildByNumber(deps.db, project.id, number)
      : undefined
    if (!build) return reply.code(404).send({ error: 'Build not found' })
    const events = await listBuildActivity(deps.db, build.id)
    const payload: Activity.Timeline = {
      events: events.map((e) => Object.assign({}, e, { at: e.at.toISOString() })),
    }
    return payload
  })
}
