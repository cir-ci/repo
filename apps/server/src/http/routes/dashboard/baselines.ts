import type { Baseline } from '@circi/api'
import { findProjectForMember, listBaselines } from '@circi/db'
import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'

import { currentUser } from '../../hooks/session.ts'
import type { DashboardDeps } from '../../lib/deps.ts'
import { parse } from '../../lib/validation.ts'

const params = z.object({ org: z.string(), project: z.string() })

/** The default branch's baselines for one project; "not found" outside the organization. */
export const dashboardBaselineRoutes: FastifyPluginAsync<DashboardDeps> = async (app, deps) => {
  app.get(
    '/projects/:org/:project/baselines',
    async (req, reply): Promise<Baseline.List | void> => {
      const p = parse(params, req.params)
      const user = currentUser(req)
      const project = await findProjectForMember(deps.db, {
        orgSlug: p.org,
        projectSlug: p.project,
        userId: user.id,
        method: user.method,
      })
      if (!project) return reply.code(404).send({ error: 'Project not found' })
      const items = await listBaselines(deps.db, {
        projectId: project.id,
        defaultBranch: project.defaultBranch,
      })
      return {
        project: { slug: project.slug, name: project.name, defaultBranch: project.defaultBranch },
        baselines: items.map((i) =>
          Object.assign({}, i, { approvedAt: i.approvedAt.toISOString() }),
        ),
      }
    },
  )
}
