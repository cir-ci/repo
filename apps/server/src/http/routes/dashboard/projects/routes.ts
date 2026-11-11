import type { Snapshot } from '@circi/api'
import { BUILD_ORDERS } from '@circi/core'
import {
  findProjectForMember,
  getBuildDetail,
  getSnapshotHistory,
  getProjectGitAttention,
  listBuildsForProject,
  listProjectsOverview,
} from '@circi/db/queries'
import { integrationRegistry } from '@circi/integrations'
import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'

import { currentUser } from '#http/hooks/session.ts'
import { buildFilterShape, toBuildFilters } from '#http/lib/build-filters.ts'
import type { Deps } from '#http/lib/deps.ts'
import { loadProject } from '#http/lib/project-access.ts'
import { parse } from '#http/lib/validation.ts'

const projectParams = z.object({ workspace: z.string(), project: z.string() })
const buildParams = projectParams.extend({ number: z.string() })
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
 * Projects, a project's builds, and one build in detail, shaped for the web app. Everything is
 * limited to the signed-in user's workspaces; a project in anyone else's is "not found".
 */
export const dashboardProjectRoutes: FastifyPluginAsync<Deps.Dashboard> = async (app, deps) => {
  app.get('/projects', async (req) => ({
    projects: await listProjectsOverview(deps.db, currentUser(req).id, currentUser(req).method),
  }))

  app.get('/projects/:workspace/:project', async (req, reply) => {
    const params = parse(projectParams, req.params)
    const project = await findProjectForMember(deps.db, {
      workspaceSlug: params.workspace,
      projectSlug: params.project,
      userId: currentUser(req).id,
      method: currentUser(req).method,
    })
    if (!project) return reply.code(404).send({ error: 'Project not found' })
    const q = parse(buildsQuery, req.query)
    const before = Number(q.before)
    const filters = toBuildFilters(q)
    const builds = await listBuildsForProject(deps.db, project.id, {
      limit: PAGE_SIZE,
      filters,
      order: q.order,
      ...(Number.isInteger(before) && before > 0 ? { beforeNumber: before } : {}),
    })
    const attention = await getProjectGitAttention(
      deps.db,
      project.id,
      integrationRegistry.gitKinds(),
    )
    return {
      project,
      builds,
      gitAttention: attention
        ? { reason: attention.reason, since: attention.since.toISOString() }
        : null,
    }
  })

  app.get('/projects/:workspace/:project/builds/:number', async (req, reply) => {
    const params = parse(buildParams, req.params)
    const project = await findProjectForMember(deps.db, {
      workspaceSlug: params.workspace,
      projectSlug: params.project,
      userId: currentUser(req).id,
      method: currentUser(req).method,
    })
    const number = Number(params.number)
    if (!project || !Number.isInteger(number))
      return reply.code(404).send({ error: 'Build not found' })
    const detail = await getBuildDetail(deps.db, project.id, number, integrationRegistry.gitKinds())
    if (!detail) return reply.code(404).send({ error: 'Build not found' })
    return { project, ...detail }
  })

  /**
   * A snapshot's recent builds on the default branch and, with `branch`, on that branch too:
   * the image and how it compared in each. The name is URL-encoded (it may hold slashes).
   */
  app.get('/projects/:workspace/:project/snapshots/:name/history', async (req, reply) => {
    const params = parse(projectParams.extend({ name: z.string().min(1).max(500) }), req.params)
    const found = await loadProject(deps, req)
    const project = found.project
    const q = parse(historyQuery, req.query)
    const history = await getSnapshotHistory(deps.db, {
      projectId: project.id,
      name: params.name,
      ...(q.branch ? { branch: q.branch } : {}),
      ...(q.limit ? { limit: q.limit } : {}),
      ...(q.build ? { build: q.build } : {}),
    })
    if (!history) return reply.code(404).send({ error: 'Project not found' })
    const payload: Snapshot.History = {
      defaultBranch: history.defaultBranch,
      default: wire(history.default),
      branch: history.branch ? wire(history.branch) : null,
    }
    return payload
  })
}
