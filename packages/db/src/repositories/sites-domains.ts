import { and, eq, isNotNull, ne } from 'drizzle-orm'

import { teamSites } from '#schema/index.ts'
import type { Database } from '#src/client.ts'
import { ConflictError, isUniqueViolation } from '#src/errors.ts'

/** A team site's custom domain (PLAN §7.6): claiming it, verifying it, releasing it. */

export namespace setSiteCustomDomain {
  export interface Result {
    slug: string
    customDomain: string
    verifiedAt: Date | null
  }
}

/**
 * Claims `domain` (already validated and lowercased) for the team's site `slug`, replacing any
 * earlier one. A new domain starts unverified; saving the same domain again keeps its
 * verification. A domain held by any other site, of this team or another, is a conflict.
 * Returns undefined when the team has no such site.
 */
export async function setSiteCustomDomain(
  db: Database,
  input: { teamId: string; slug: string; domain: string },
): Promise<setSiteCustomDomain.Result | undefined> {
  const [site] = await db
    .select()
    .from(teamSites)
    .where(and(eq(teamSites.teamId, input.teamId), eq(teamSites.slug, input.slug)))
  if (!site) return undefined
  if (site.customDomain === input.domain) {
    return { slug: site.slug, customDomain: input.domain, verifiedAt: site.customDomainVerifiedAt }
  }
  const [taken] = await db
    .select({ id: teamSites.id })
    .from(teamSites)
    .where(and(eq(teamSites.customDomain, input.domain), ne(teamSites.id, site.id)))
  if (taken) throw new ConflictError(`${input.domain} is already used by another site`)
  try {
    await db
      .update(teamSites)
      .set({ customDomain: input.domain, customDomainVerifiedAt: null })
      .where(eq(teamSites.id, site.id))
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new ConflictError(`${input.domain} is already used by another site`)
    }
    throw err
  }
  return { slug: site.slug, customDomain: input.domain, verifiedAt: null }
}

/** Releases a site's custom domain. Returns whether the team has such a site. */
export async function clearSiteCustomDomain(
  db: Database,
  input: { teamId: string; slug: string },
): Promise<boolean> {
  const rows = await db
    .update(teamSites)
    .set({ customDomain: null, customDomainVerifiedAt: null })
    .where(and(eq(teamSites.teamId, input.teamId), eq(teamSites.slug, input.slug)))
    .returning({ id: teamSites.id })
  return rows.length > 0
}

/** Records the outcome of a DNS check for the domain a site holds now. */
export async function markSiteCustomDomainVerified(
  db: Database,
  input: { teamId: string; slug: string; domain: string; verified: boolean; now?: Date },
): Promise<void> {
  await db
    .update(teamSites)
    .set({ customDomainVerifiedAt: input.verified ? (input.now ?? new Date()) : null })
    .where(
      and(
        eq(teamSites.teamId, input.teamId),
        eq(teamSites.slug, input.slug),
        eq(teamSites.customDomain, input.domain),
        isNotNull(teamSites.customDomain),
      ),
    )
}
