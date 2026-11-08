import type { Activity } from '@circi/api'
import { getBuildByNumber, listBuildActivity } from '@circi/db'
import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'

import type { Deps } from '#http/lib/deps.ts'
import { loadTeam } from '#http/lib/team-access.ts'
import { parse } from '#http/lib/validation.ts'

const params = z.object({ workspace: z.string(), team: z.string(), number: z.string() })

/** `GET …/builds/:number/activity`: what happened to a build, oldest first. Members only. */
export const dashboardActivityRoutes: FastifyPluginAsync<Deps.Dashboard> = async (app, deps) => {
  app.get('/teams/:workspace/:team/builds/:number/activity', async (req, reply) => {
    const access = await loadTeam(deps, req, reply)
    if (!access) return reply
    const { team } = access
    const number = Number(parse(params, req.params).number)
    const build = Number.isInteger(number)
      ? await getBuildByNumber(deps.db, team.id, number)
      : undefined
    if (!build) return reply.code(404).send({ error: 'Build not found' })
    const events = await listBuildActivity(deps.db, build.id)
    const payload: Activity.Timeline = {
      events: events.map((e) => Object.assign({}, e, { at: e.at.toISOString() })),
    }
    return payload
  })
}
