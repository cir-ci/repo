import type { Snapshot } from '@circi/api'
import { BUILD_ORDERS } from '@circi/core'
import {
  findTeamForMember,
  getBuildDetail,
  getSnapshotHistory,
  getTeamGitAttention,
  listBuildsForTeam,
  listTeamsOverview,
} from '@circi/db/queries'
import { integrationRegistry } from '@circi/integrations'
import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'

import { currentUser } from '#http/hooks/session.ts'
import { buildFilterShape, toBuildFilters } from '#http/lib/build-filters.ts'
import type { Deps } from '#http/lib/deps.ts'
import { loadTeam } from '#http/lib/team-access.ts'
import { parse } from '#http/lib/validation.ts'

const teamParams = z.object({ workspace: z.string(), team: z.string() })
const buildParams = teamParams.extend({ number: z.string() })
const buildsQuery = z.object({
  /** The build number the page starts after, in `order`. */
  before: z.string().optional(),
  order: z.enum(BUILD_ORDERS).default('newest'),
  ...buildFilterShape,
})

const historyQuery = z.object({
  limit: z.coerce.number().int().min(1).max(20).optional(),
  branch: z.string().max(500).optional(),
  /** Start the default branch list at this build number (inclusive). */
  build: z.coerce.number().int().min(1).optional(),
})

const wire = (entries: getSnapshotHistory.Entry[]): Snapshot.HistoryEntry[] =>
  entries.map((e) => ({
    ...e,
    build: { ...e.build, createdAt: e.build.createdAt.toISOString() },
  }))

/** Builds list page size; the web app shows "Older builds" when a page is full. */
const PAGE_SIZE = 50

/**
 * Teams, a team's builds, and one build in detail, shaped for the web app. Everything is
 * limited to the signed-in user's workspaces; a team in anyone else's is "not found".
 */
export const dashboardTeamRoutes: FastifyPluginAsync<Deps.Dashboard> = async (app, deps) => {
  app.get('/teams', async (req) => ({
    teams: await listTeamsOverview(deps.db, currentUser(req).id, currentUser(req).method),
  }))

  app.get('/teams/:workspace/:team', async (req, reply) => {
    const params = parse(teamParams, req.params)
    const team = await findTeamForMember(deps.db, {
      workspaceSlug: params.workspace,
      teamSlug: params.team,
      userId: currentUser(req).id,
      method: currentUser(req).method,
    })
    if (!team) return reply.code(404).send({ error: 'Team not found' })
    const q = parse(buildsQuery, req.query)
    const before = Number(q.before)
    const filters = toBuildFilters(q)
    const builds = await listBuildsForTeam(deps.db, team.id, {
      limit: PAGE_SIZE,
      filters,
      order: q.order,
      ...(Number.isInteger(before) && before > 0 ? { beforeNumber: before } : {}),
    })
    const attention = await getTeamGitAttention(deps.db, team.id, integrationRegistry.gitKinds())
    return {
      team,
      builds,
      gitAttention: attention
        ? { reason: attention.reason, since: attention.since.toISOString() }
        : null,
    }
  })

  app.get('/teams/:workspace/:team/builds/:number', async (req, reply) => {
    const params = parse(buildParams, req.params)
    const team = await findTeamForMember(deps.db, {
      workspaceSlug: params.workspace,
      teamSlug: params.team,
      userId: currentUser(req).id,
      method: currentUser(req).method,
    })
    const number = Number(params.number)
    if (!team || !Number.isInteger(number))
      return reply.code(404).send({ error: 'Build not found' })
    const detail = await getBuildDetail(deps.db, team.id, number, integrationRegistry.gitKinds())
    if (!detail) return reply.code(404).send({ error: 'Build not found' })
    return { team, ...detail }
  })

  /**
   * A snapshot's recent builds on the default branch and, with `branch`, on that branch too:
   * the image and how it compared in each. The name is URL-encoded (it may hold slashes).
   */
  app.get('/teams/:workspace/:team/snapshots/:name/history', async (req, reply) => {
    const params = parse(teamParams.extend({ name: z.string().min(1).max(500) }), req.params)
    const found = await loadTeam(deps, req)
    const team = found.team
    const q = parse(historyQuery, req.query)
    const history = await getSnapshotHistory(deps.db, {
      teamId: team.id,
      name: params.name,
      ...(q.branch ? { branch: q.branch } : {}),
      ...(q.limit ? { limit: q.limit } : {}),
      ...(q.build ? { build: q.build } : {}),
    })
    if (!history) return reply.code(404).send({ error: 'Team not found' })
    const payload: Snapshot.History = {
      defaultBranch: history.defaultBranch,
      default: wire(history.default),
      branch: history.branch ? wire(history.branch) : null,
    }
    return payload
  })
}
