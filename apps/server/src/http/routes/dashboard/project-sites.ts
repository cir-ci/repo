import { findProjectForMember, listProjectSites } from '@circi/db'
import { isSiteKindId, KINDS } from '@circi/sites'
import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'

import type { DashboardDeps } from '../../deps.ts'
import { currentUser } from '../../hooks/session.ts'
import { parse } from '../../validation.ts'

const params = z.object({ org: z.string(), project: z.string() })

/**
 * `GET /api/projects/:org/:project/sites`: the project's hosted sites and their addresses. The
 * dashboard only links out: it never serves a site's files (PLAN §7.6).
 */
export const dashboardProjectSitesRoutes: FastifyPluginAsync<DashboardDeps> = async (app, deps) => {
  app.get('/projects/:org/:project/sites', async (req, reply) => {
    const p = parse(params, req.params)
    const user = currentUser(req)
    const project = await findProjectForMember(deps.db, {
      orgSlug: p.org,
      projectSlug: p.project,
      userId: user.id,
      method: user.method,
    })
    if (!project) return reply.code(404).send({ error: 'Project not found' })
    const sites = deps.sites
    if (!sites) return { configured: false, sites: [] }
    const listing = await listProjectSites(deps.db, project.id)
    return {
      configured: true,
      sites: listing.map((s) => ({
        name: s.name,
        kind: s.kind,
        kindLabel: isSiteKindId(s.kind) ? KINDS[s.kind].label : s.kind,
        slug: s.slug,
        branches: s.branches.map((b) => ({
          branch: b.branch,
          address: sites.originFor(b.label),
          commitSha: b.commitSha,
          updatedAt: b.updatedAt.toISOString(),
        })),
        versions: s.versions.map((v) => ({
          commitSha: v.commitSha,
          branch: v.branch,
          createdAt: v.createdAt.toISOString(),
          totalBytes: v.totalBytes,
          address: v.commitLabel ? sites.originFor(v.commitLabel) : null,
        })),
      })),
    }
  })
}
