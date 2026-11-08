import type { Search } from '@circi/api'
import { searchOrganization } from '@circi/db'
import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'

import { currentUser } from '#http/hooks/session.ts'
import type { Deps } from '#http/lib/deps.ts'
import { parse } from '#http/lib/validation.ts'

const params = z.object({ org: z.string() })
const query = z.object({ q: z.string().max(100).default('') })

/**
 * `GET /api/orgs/:org/search?q=`: the command menu's search over the organization's builds,
 * branches, projects and screenshot names. Everyone outside the organization gets "not found".
 */
export const dashboardSearchRoutes: FastifyPluginAsync<Deps.Dashboard> = async (app, deps) => {
  app.get('/orgs/:org/search', async (req, reply): Promise<Search.Results | void> => {
    const p = parse(params, req.params)
    const { q } = parse(query, req.query)
    const user = currentUser(req)
    const results = await searchOrganization(deps.db, {
      userId: user.id,
      orgSlug: p.org,
      query: q,
      method: user.method,
    })
    if (!results) return reply.code(404).send({ error: 'Organization not found' })
    return results
  })
}
