import type { WorkspaceBuilds } from '@circi/api'
import { BUILD_ORDERS } from '@circi/core'
import {
  BRANCH_LIMIT,
  listBranches,
  listBuildFilterSuggestions,
  listBuildsForWorkspace,
} from '@circi/db/queries'
import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'

import { currentUser } from '#http/hooks/session.ts'
import { buildFilterShape, toBuildFilters } from '#http/lib/build-filters.ts'
import type { Deps } from '#http/lib/deps.ts'
import { parse } from '#http/lib/validation.ts'

const params = z.object({ workspace: z.string() })
const listQuery = z.object({
  before: z.uuid().optional(),
  order: z.enum(BUILD_ORDERS).default('newest'),
  ...buildFilterShape,
})
const suggestQuery = z.object({
  field: z.enum(['author', 'reviewer']),
  q: z.string().max(100).default(''),
})

const branchQuery = z.object({
  team: z.string().optional(),
  q: z.string().max(255).default(''),
  limit: z.coerce.number().int().min(1).max(100).default(BRANCH_LIMIT),
})

/** Page size of the workspace-wide builds list; the same as a team's. */
const PAGE_SIZE = 50

/**
 * The builds of every team of a workspace in one list (a saved view with no team), with the
 * filters and paging of a team's list, and the suggestions for the author and reviewer chips.
 * Members only; everyone else gets "not found".
 */
export const dashboardWorkspaceBuildsRoutes: FastifyPluginAsync<Deps.Dashboard> = async (
  app,
  deps,
) => {
  app.get(
    '/workspaces/:workspace/builds',
    async (req, reply): Promise<WorkspaceBuilds.List | void> => {
      const p = parse(params, req.params)
      const q = parse(listQuery, req.query)
      const user = currentUser(req)
      const filters = toBuildFilters(q)
      const found = await listBuildsForWorkspace(deps.db, {
        userId: user.id,
        workspaceSlug: p.workspace,
        method: user.method,
        limit: PAGE_SIZE,
        filters,
        order: q.order,
        ...(q.before ? { before: q.before } : {}),
      })
      if (!found) return reply.code(404).send({ error: 'Workspace not found' })
      const last = found.builds.at(-1)
      return {
        workspace: found.workspace,
        builds: found.builds.map((b) => ({ ...b, createdAt: b.createdAt.toISOString() })),
        next: found.builds.length === PAGE_SIZE && last ? last.id : null,
      }
    },
  )

  app.get(
    '/workspaces/:workspace/builds/suggestions',
    async (req, reply): Promise<WorkspaceBuilds.Suggestions | void> => {
      const p = parse(params, req.params)
      const q = parse(suggestQuery, req.query)
      const user = currentUser(req)
      const found = await listBuildFilterSuggestions(deps.db, {
        userId: user.id,
        workspaceSlug: p.workspace,
        method: user.method,
        field: q.field,
        query: q.q,
      })
      if (!found) return reply.code(404).send({ error: 'Workspace not found' })
      return { suggestions: found }
    },
  )

  app.get(
    '/workspaces/:workspace/builds/branches',
    async (req, reply): Promise<WorkspaceBuilds.Branches | void> => {
      const p = parse(params, req.params)
      const q = parse(branchQuery, req.query)
      const user = currentUser(req)
      const found = await listBranches(deps.db, {
        userId: user.id,
        workspaceSlug: p.workspace,
        method: user.method,
        teamSlug: q.team,
        query: q.q,
        limit: q.limit,
      })
      if (!found) return reply.code(404).send({ error: 'Workspace or team not found' })
      return {
        branches: found.map((b) => ({ name: b.name, lastBuildAt: b.lastBuildAt.toISOString() })),
      }
    },
  )
}
