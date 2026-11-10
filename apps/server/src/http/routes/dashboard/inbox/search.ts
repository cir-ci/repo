import type { Search } from '@circi/api'
import { SEARCH_KINDS, SEARCH_MAX_LIMIT, searchWorkspace } from '@circi/db/queries'
import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'

import { currentUser } from '#http/hooks/session.ts'
import type { Deps } from '#http/lib/deps.ts'
import { parse } from '#http/lib/validation.ts'

const params = z.object({ workspace: z.string() })
const kindList = z
  .string()
  .max(200)
  .transform((value) => value.split(',').filter(Boolean))
  .pipe(z.array(z.enum(SEARCH_KINDS)).max(SEARCH_KINDS.length))
const query = z.object({
  q: z.string().max(100).default(''),
  /** A team's slug: only its results. */
  team: z.string().max(100).optional(),
  kinds: kindList.optional(),
  limit: z.coerce.number().int().min(1).max(SEARCH_MAX_LIMIT).optional(),
})

/**
 * `GET /api/workspaces/:workspace/search?q=&team=&kinds=&limit=`: the command menu's search over the
 * workspace's builds, branches, teams, screenshots, baselines, triage, notifications, reviews, people and
 * views, optionally of one team and some kinds. Everyone outside the workspace gets "not found".
 */
export const dashboardSearchRoutes: FastifyPluginAsync<Deps.Dashboard> = async (app, deps) => {
  app.get('/workspaces/:workspace/search', async (req, reply): Promise<Search.Results | void> => {
    const p = parse(params, req.params)
    const { q, team, kinds, limit } = parse(query, req.query)
    const user = currentUser(req)
    const results = await searchWorkspace(deps.db, {
      userId: user.id,
      workspaceSlug: p.workspace,
      query: q,
      ...(team === undefined ? {} : { team }),
      ...(kinds === undefined ? {} : { kinds }),
      ...(limit === undefined ? {} : { limit }),
      method: user.method,
    })
    if (!results) return reply.code(404).send({ error: 'Workspace not found' })
    return {
      ...results,
      notifications: results.notifications.map((n) =>
        Object.assign({}, n, { createdAt: n.createdAt.toISOString() }),
      ),
      reviews: results.reviews.map((r) =>
        Object.assign({}, r, { createdAt: r.createdAt.toISOString() }),
      ),
    }
  })
}
