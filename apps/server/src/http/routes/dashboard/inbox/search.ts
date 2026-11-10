import type { Search } from '@circi/api'
import { searchWorkspace } from '@circi/db/queries'
import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'

import { currentUser } from '#http/hooks/session.ts'
import type { Deps } from '#http/lib/deps.ts'
import { parse } from '#http/lib/validation.ts'

const params = z.object({ workspace: z.string() })
const query = z.object({ q: z.string().max(100).default('') })

/**
 * `GET /api/workspaces/:workspace/search?q=`: the command menu's search over the workspace's builds,
 * branches, teams and screenshot names. Everyone outside the workspace gets "not found".
 */
export const dashboardSearchRoutes: FastifyPluginAsync<Deps.Dashboard> = async (app, deps) => {
  app.get('/workspaces/:workspace/search', async (req, reply): Promise<Search.Results | void> => {
    const p = parse(params, req.params)
    const { q } = parse(query, req.query)
    const user = currentUser(req)
    const results = await searchWorkspace(deps.db, {
      userId: user.id,
      workspaceSlug: p.workspace,
      query: q,
      method: user.method,
    })
    if (!results) return reply.code(404).send({ error: 'Workspace not found' })
    return {
      ...results,
      notifications: results.notifications.map((n) =>
        Object.assign({}, n, { createdAt: n.createdAt.toISOString() }),
      ),
    }
  })
}
