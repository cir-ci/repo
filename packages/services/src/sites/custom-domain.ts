import { resolve4, resolve6, resolveCname } from 'node:dns/promises'

import {
  customDomainProblem,
  normalizeCustomDomain,
  NotFoundError,
  ValidationError,
} from '@circi/core'
import { type Database } from '@circi/db'
import { getSiteCustomDomain } from '@circi/db/queries'
import {
  clearSiteCustomDomain,
  markSiteCustomDomainVerified,
  setSiteCustomDomain,
} from '@circi/db/repositories'

/**
 * A team site's custom domain (PLAN §7.6): one domain, e.g. `storybook.acme.com`, that serves the
 * team's default-branch version of the site. Claiming it only reserves it: it is served (and a
 * certificate issued for it) once a DNS check has seen it point at this server.
 */

/** What the DNS check asks of the network; tests replace it (the real one needs real DNS). */
export interface SiteDnsResolver {
  /** CNAME targets of a name, or none. */
  cname(host: string): Promise<string[]>
  /** A and AAAA addresses of a name, or none. */
  address(host: string): Promise<string[]>
}

const missing = (err: unknown) =>
  err instanceof Error &&
  'code' in err &&
  typeof err.code === 'string' &&
  ['ENODATA', 'ENOTFOUND', 'ENOENT'].includes(err.code)

async function orNone(lookup: Promise<string[]>): Promise<string[]> {
  try {
    return await lookup
  } catch (err) {
    if (missing(err)) return []
    throw err
  }
}

export const systemDnsResolver: SiteDnsResolver = {
  cname: (host) => orNone(resolveCname(host)),
  address: async (host) => [...(await orNone(resolve4(host))), ...(await orNone(resolve6(host)))],
}

/** The name a custom domain's CNAME should point at: any name under the sites domain resolves to the server. */
export const customDomainTarget = (sitesHost: string) => `custom.${sitesHost}`

/**
 * Claims a custom domain for the team's site `slug`. It must be a plain domain name, unrelated
 * to the dashboard (the sites cookie rule) and to the sites domain, and not used by any other
 * site. Replaces an earlier domain of the site, which stops being served at once.
 */
export async function setCustomDomain(
  db: Database,
  input: setCustomDomain.Input,
): Promise<setCustomDomain.Result> {
  const domain = normalizeCustomDomain(input.domain)
  const problem = customDomainProblem(domain, input.hosts)
  if (problem) throw new ValidationError(problem)
  const set = await db.transaction((tx) =>
    setSiteCustomDomain(tx, { teamId: input.teamId, slug: input.slug, domain }),
  )
  if (!set) throw new NotFoundError('Site not found')
  return { domain, verifiedAt: set.verifiedAt }
}
export namespace setCustomDomain {
  export interface Hosts {
    /** The dashboard's host name, whose cookies a site must not share. */
    dashboardHost: string
    /** The sites domain. */
    sitesHost: string
  }
  export interface Input {
    teamId: string
    slug: string
    domain: string
    hosts: setCustomDomain.Hosts
  }
  export interface Result {
    domain: string
    verifiedAt: Date | null
  }
}

/** Releases the site's custom domain: it stops being served and may be claimed by another site. */
export async function clearCustomDomain(
  db: Database,
  input: { teamId: string; slug: string },
): Promise<void> {
  const found = await db.transaction((tx) => clearSiteCustomDomain(tx, input))
  if (!found) throw new NotFoundError('Site not found')
}

/**
 * Checks DNS for the site's domain and records the outcome: verified when its CNAME chain
 * reaches the sites domain (or the dashboard host), or its addresses include the server's. A
 * domain that no longer checks out becomes unverified again. A lookup that fails for any other
 * reason (a timeout) reports it and leaves the recorded state alone.
 */
export async function verifyCustomDomain(
  db: Database,
  input: verifyCustomDomain.Input,
): Promise<verifyCustomDomain.Result> {
  const state = await getSiteCustomDomain(db, input.teamId, input.slug)
  if (!state) throw new NotFoundError('Site not found')
  if (!state.domain) throw new ValidationError('This site has no custom domain')
  const domain = state.domain
  const resolver = input.resolver ?? systemDnsResolver
  const { sitesHost, dashboardHost } = input.hosts
  const target = customDomainTarget(sitesHost)

  let outcome: { verified: boolean; reason?: string }
  try {
    outcome = await checkDns(resolver, domain, { sitesHost, dashboardHost, target })
  } catch {
    return {
      domain,
      verified: state.verifiedAt !== null,
      verifiedAt: state.verifiedAt,
      error: 'The DNS lookup failed. Try again in a minute.',
    }
  }
  const verifiedAt = outcome.verified ? new Date() : null
  await db.transaction((tx) =>
    markSiteCustomDomainVerified(tx, {
      teamId: input.teamId,
      slug: input.slug,
      domain,
      verified: outcome.verified,
      ...(verifiedAt ? { now: verifiedAt } : {}),
    }),
  )
  return {
    domain,
    verified: outcome.verified,
    verifiedAt,
    ...(outcome.reason ? { error: outcome.reason } : {}),
  }
}
export namespace verifyCustomDomain {
  export interface Input {
    teamId: string
    slug: string
    hosts: setCustomDomain.Hosts
    resolver?: SiteDnsResolver | undefined
  }
  export interface Result {
    domain: string
    verified: boolean
    verifiedAt: Date | null
    /** Why it is not verified (or why the check could not run). */
    error?: string
  }
}

const bare = (host: string) => host.toLowerCase().replace(/\.$/, '')

async function checkDns(
  resolver: SiteDnsResolver,
  domain: string,
  hosts: { sitesHost: string; dashboardHost: string; target: string },
): Promise<{ verified: boolean; reason?: string }> {
  const sites = bare(hosts.sitesHost)
  const dashboard = bare(hosts.dashboardHost)
  // Follow the CNAME chain (a few hops at most); any step landing on the server's names counts.
  const chain: string[] = []
  let current = domain
  for (let hop = 0; hop < 5; hop += 1) {
    // eslint-disable-next-line no-await-in-loop -- each hop depends on the last
    const [next] = await resolver.cname(current)
    if (!next) break
    current = bare(next)
    chain.push(current)
  }
  if (chain.some((name) => name === dashboard || name.endsWith(`.${sites}`))) {
    return { verified: true }
  }
  // An address record (an apex domain cannot be a CNAME): the same addresses as the server's.
  const mine = await resolver.address(current)
  if (mine.length === 0 && chain.length === 0) {
    return {
      verified: false,
      reason: `No DNS record found for ${domain}. Add a CNAME to ${hosts.target}, then check again.`,
    }
  }
  const server = new Set([
    ...(await resolver.address(hosts.target)),
    ...(await resolver.address(dashboard)),
  ])
  if (mine.some((a) => server.has(a))) return { verified: true }
  return {
    verified: false,
    reason:
      chain.length > 0
        ? `${domain} points at ${chain.at(-1)}, not at this server. Change its CNAME to ${hosts.target}.`
        : `${domain} resolves to ${mine.join(', ')}, not to this server. Point a CNAME at ${hosts.target}.`,
  }
}
