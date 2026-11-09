import { listFlakyScreenshots, listTeamSites } from '@circi/db/queries'
import { isSiteKindId, KINDS } from '@circi/sites'
import type { FastifyPluginAsync } from 'fastify'

import type { Deps } from '#http/lib/deps.ts'
import { loadTeam } from '#http/lib/team-access.ts'

/**
 * `GET /api/teams/:workspace/:team/sites`: the team's hosted sites and their addresses. The
 * dashboard only links out: it never serves a site's files (PLAN §7.6).
 */
export const dashboardTeamSitesRoutes: FastifyPluginAsync<Deps.Dashboard> = async (app, deps) => {
  app.get('/teams/:workspace/:team/sites', async (req) => {
    const { team } = await loadTeam(deps, req)
    const sites = deps.sites
    if (!sites) return { configured: false, sites: [] }
    const listing = await listTeamSites(deps.db, team.id)
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

  /** Screenshots that keep changing on the default branch: probably flaky, not really changed. */
  app.get('/teams/:workspace/:team/flaky', async (req) => {
    const { team } = await loadTeam(deps, req)
    return listFlakyScreenshots(deps.db, team.id)
  })
}
