import type { Baseline } from '@circi/api'
import { listBaselines } from '@circi/db/queries'
import type { FastifyPluginAsync } from 'fastify'

import type { Deps } from '#http/lib/deps.ts'
import { loadTeam } from '#http/lib/team-access.ts'

/** The default branch's baselines for one team; "not found" outside the workspace. */
export const dashboardBaselineRoutes: FastifyPluginAsync<Deps.Dashboard> = async (app, deps) => {
  app.get('/teams/:workspace/:team/baselines', async (req): Promise<Baseline.List> => {
    const { team } = await loadTeam(deps, req)
    const items = await listBaselines(deps.db, {
      teamId: team.id,
      defaultBranch: team.defaultBranch,
    })
    return {
      team: { slug: team.slug, name: team.name, defaultBranch: team.defaultBranch },
      baselines: items.map((i) => Object.assign({}, i, { approvedAt: i.approvedAt.toISOString() })),
    }
  })
}
