import type { Baseline } from '@circi/api'
import { findTeamForMember, listBaselines } from '@circi/db'
import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'

import { currentUser } from '#http/hooks/session.ts'
import type { Deps } from '#http/lib/deps.ts'
import { parse } from '#http/lib/validation.ts'

const params = z.object({ workspace: z.string(), team: z.string() })

/** The default branch's baselines for one team; "not found" outside the workspace. */
export const dashboardBaselineRoutes: FastifyPluginAsync<Deps.Dashboard> = async (app, deps) => {
  app.get(
    '/teams/:workspace/:team/baselines',
    async (req, reply): Promise<Baseline.List | void> => {
      const p = parse(params, req.params)
      const user = currentUser(req)
      const team = await findTeamForMember(deps.db, {
        workspaceSlug: p.workspace,
        teamSlug: p.team,
        userId: user.id,
        method: user.method,
      })
      if (!team) return reply.code(404).send({ error: 'Team not found' })
      const items = await listBaselines(deps.db, {
        teamId: team.id,
        defaultBranch: team.defaultBranch,
      })
      return {
        team: { slug: team.slug, name: team.name, defaultBranch: team.defaultBranch },
        baselines: items.map((i) =>
          Object.assign({}, i, { approvedAt: i.approvedAt.toISOString() }),
        ),
      }
    },
  )
}
