import type { Site } from '@circi/api'
import { clearCustomDomain, setCustomDomain, verifyCustomDomain } from '@circi/services'
import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'

import type { Deps } from '#http/lib/deps.ts'
import { loadTeam } from '#http/lib/team-access.ts'
import { parse } from '#http/lib/validation.ts'

const params = z.object({ workspace: z.string(), team: z.string(), site: z.string() })
const body = z.object({ domain: z.string().min(1).max(260) })

/**
 * A site's custom domain (owners and admins): set, check its DNS, remove. The domain serves the
 * team's default branch version of the site, once verified. See docs/reference/static-sites.md.
 */
export const dashboardSiteDomainRoutes: FastifyPluginAsync<Deps.Dashboard> = async (app, deps) => {
  const base = '/teams/:workspace/:team/sites/:site/domain'
  const manage = { manage: true, forbidden: 'Only owners and admins can change a custom domain' }
  const notSetUp = { error: "Static site hosting isn't set up on this server" }

  const hostsOf = (sitesHost: string) => ({
    dashboardHost: new URL(deps.publicOrigin).hostname,
    sitesHost,
  })

  app.put(base, async (req, reply) => {
    const { team } = await loadTeam(deps, req, manage)
    const sites = deps.sites
    if (!sites) return reply.code(404).send(notSetUp)
    const { site } = parse(params, req.params)
    const set = await setCustomDomain(deps.db, {
      teamId: team.id,
      slug: site,
      domain: parse(body, req.body).domain,
      hosts: hostsOf(sites.host),
    })
    const result: Site.CustomDomain = {
      domain: set.domain,
      verified: set.verifiedAt !== null,
      verifiedAt: set.verifiedAt?.toISOString() ?? null,
      address: sites.originFor(set.domain),
    }
    return result
  })

  app.delete(base, async (req, reply) => {
    const { team } = await loadTeam(deps, req, manage)
    if (!deps.sites) return reply.code(404).send(notSetUp)
    await clearCustomDomain(deps.db, { teamId: team.id, slug: parse(params, req.params).site })
    return reply.code(204).send()
  })

  /** Looks at DNS now and records whether the domain points at this server. */
  app.post(`${base}/verify`, async (req, reply) => {
    const { team } = await loadTeam(deps, req, manage)
    const sites = deps.sites
    if (!sites) return reply.code(404).send(notSetUp)
    const checked = await verifyCustomDomain(deps.db, {
      teamId: team.id,
      slug: parse(params, req.params).site,
      hosts: hostsOf(sites.host),
      resolver: deps.resolveDns,
    })
    const result: Site.DomainCheck = {
      domain: checked.domain,
      verified: checked.verified,
      verifiedAt: checked.verifiedAt?.toISOString() ?? null,
      error: checked.error ?? null,
    }
    return result
  })
}
