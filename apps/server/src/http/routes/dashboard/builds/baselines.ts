import type { Baseline } from '@circi/api'
import { listBaselines } from '@circi/db/queries'
import type { FastifyPluginAsync } from 'fastify'

import type { Deps } from '#http/lib/deps.ts'
import { loadProject } from '#http/lib/project-access.ts'

/** The default branch's baselines for one project; "not found" outside the workspace. */
export const dashboardBaselineRoutes: FastifyPluginAsync<Deps.Dashboard> = async (app, deps) => {
  app.get('/projects/:workspace/:project/baselines', async (req): Promise<Baseline.List> => {
    const { project } = await loadProject(deps, req)
    const items = await listBaselines(deps.db, {
      projectId: project.id,
      defaultBranch: project.defaultBranch,
    })
    return {
      project: { slug: project.slug, name: project.name, defaultBranch: project.defaultBranch },
      baselines: items.map((i) => Object.assign({}, i, { approvedAt: i.approvedAt.toISOString() })),
    }
  })
}
