import { findProjectForMember, getBuildByNumber, reviewBuild } from '@circi/db'
import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'

import type { DashboardDeps } from '../../deps.ts'
import { currentUser } from '../../hooks/session.ts'
import { parse } from '../../validation.ts'

const params = z.object({ org: z.string(), project: z.string(), number: z.string() })
const body = z.object({ state: z.enum(['approved', 'rejected']) })

/**
 * `POST …/builds/:number/review`: approve or reject a build's changes. Any member of the
 * project's organization may decide; everyone else gets the same "not found" as for a build
 * that doesn't exist. Decisions can be changed, and the latest one counts.
 */
export const dashboardReviewRoutes: FastifyPluginAsync<DashboardDeps> = async (app, deps) => {
  app.post('/projects/:org/:project/builds/:number/review', async (req, reply) => {
    const p = parse(params, req.params)
    const { state } = parse(body, req.body)
    const user = currentUser(req)
    const project = await findProjectForMember(deps.db, {
      orgSlug: p.org,
      projectSlug: p.project,
      userId: user.id,
    })
    const number = Number(p.number)
    const build =
      project && Number.isInteger(number)
        ? await getBuildByNumber(deps.db, project.id, number)
        : undefined
    if (!build) return reply.code(404).send({ error: 'Build not found' })

    const updated = await reviewBuild(deps.db, { buildId: build.id, userId: user.id, state })
    return {
      build: {
        number: updated.number,
        status: updated.status,
        conclusion: updated.conclusion,
        reviewStatus: updated.reviewStatus,
      },
    }
  })
}
