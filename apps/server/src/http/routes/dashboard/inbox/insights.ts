import type { Insights } from '@circi/api'
import { getInsights } from '@circi/db'
import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'

import { currentUser } from '#http/hooks/session.ts'
import type { Deps } from '#http/lib/deps.ts'
import { parse } from '#http/lib/validation.ts'

const DAY_MS = 86_400_000
/** Longest range one request may ask for. */
const MAX_DAYS = 366

const iso = (d: Date) => d.toISOString()

const params = z.object({ workspace: z.string() })
const query = z.object({
  team: z.string().optional(),
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
})

/**
 * Insights for one workspace (or one of its teams) over a date range, default the last 30
 * days. Everyone outside the workspace gets "not found".
 */
export const dashboardInsightsRoutes: FastifyPluginAsync<Deps.Dashboard> = async (app, deps) => {
  app.get(
    '/workspaces/:workspace/insights',
    async (req, reply): Promise<Insights.Report | void> => {
      const p = parse(params, req.params)
      const q = parse(query, req.query)
      const to = q.to ? new Date(q.to) : new Date()
      const from = q.from ? new Date(q.from) : new Date(to.getTime() - 30 * DAY_MS)
      if (from >= to || to.getTime() - from.getTime() > MAX_DAYS * DAY_MS) {
        return reply
          .code(400)
          .send({ error: `from must be before to, at most ${MAX_DAYS} days apart` })
      }
      const user = currentUser(req)
      const report = await getInsights(deps.db, {
        userId: user.id,
        workspaceSlug: p.workspace,
        ...(q.team === undefined ? {} : { teamSlug: q.team }),
        from,
        to,
        method: user.method,
      })
      if (!report) return reply.code(404).send({ error: 'Workspace not found' })
      return {
        ...report,
        range: { from: iso(from), to: iso(to) },
        weeks: report.weeks.map((w) => Object.assign({}, w, { weekStart: iso(w.weekStart) })),
      }
    },
  )
}
