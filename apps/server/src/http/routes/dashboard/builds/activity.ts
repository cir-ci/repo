import type { Activity } from '@circi/api'
import { getBuildByNumber, listBuildActivity } from '@circi/db/queries'
import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'

import type { Deps } from '#http/lib/deps.ts'
import { loadProject } from '#http/lib/project-access.ts'
import { parse } from '#http/lib/validation.ts'

const params = z.object({ workspace: z.string(), project: z.string(), number: z.string() })

/** `GET …/builds/:number/activity`: what happened to a build, oldest first. Members only. */
export const dashboardActivityRoutes: FastifyPluginAsync<Deps.Dashboard> = async (app, deps) => {
  app.get('/projects/:workspace/:project/builds/:number/activity', async (req, reply) => {
    const access = await loadProject(deps, req)
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
