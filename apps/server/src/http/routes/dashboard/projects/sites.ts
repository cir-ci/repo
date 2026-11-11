import { listFlakyScreenshots, listProjectsites } from '@circi/db/queries'
import { customDomainTarget } from '@circi/services'
import { isSiteKindId, KINDS } from '@circi/sites'
import type { FastifyPluginAsync } from 'fastify'

import type { Deps } from '#http/lib/deps.ts'
import { loadProject } from '#http/lib/project-access.ts'

/**
 * `GET /api/projects/:workspace/:project/sites`: the project's hosted sites and their addresses. The
 * dashboard only links out: it never serves a site's files (PLAN §7.6).
 */
export const dashboardProjectsitesRoutes: FastifyPluginAsync<Deps.Dashboard> = async (
  app,
  deps,
) => {
  app.get('/projects/:workspace/:project/sites', async (req) => {
    const { project, canManage } = await loadProject(deps, req)
    const sites = deps.sites
    if (!sites) return { configured: false, dnsTarget: null, canManage, sites: [] }
    const listing = await listProjectsites(deps.db, project.id)
    return {
      configured: true,
      dnsTarget: customDomainTarget(sites.host),
      canManage,
      sites: listing.map((s) => ({
        name: s.name,
        kind: s.kind,
        kindLabel: isSiteKindId(s.kind) ? KINDS[s.kind].label : s.kind,
        slug: s.slug,
        customDomain: s.customDomain
          ? {
              domain: s.customDomain.domain,
              verified: s.customDomain.verifiedAt !== null,
              verifiedAt: s.customDomain.verifiedAt?.toISOString() ?? null,
              address: sites.originFor(s.customDomain.domain),
            }
          : null,
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
  app.get('/projects/:workspace/:project/flaky', async (req) => {
    const { project } = await loadProject(deps, req)
    return listFlakyScreenshots(deps.db, project.id)
  })
}
