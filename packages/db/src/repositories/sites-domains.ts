import { and, eq, isNotNull, ne } from 'drizzle-orm'

import { projectsites } from '#schema/index.ts'
import type { Database } from '#src/client.ts'
import { ConflictError, isUniqueViolation } from '#src/errors.ts'

/** A project site's custom domain (PLAN §7.6): claiming it, verifying it, releasing it. */

export namespace setSiteCustomDomain {
  export interface Result {
    slug: string
    customDomain: string
    verifiedAt: Date | null
  }
}

/**
 * Claims `domain` (already validated and lowercased) for the project's site `slug`, replacing any
 * earlier one. A new domain starts unverified; saving the same domain again keeps its
 * verification. A domain held by any other site, of this project or another, is a conflict.
 * Returns undefined when the project has no such site.
 */
export async function setSiteCustomDomain(
  db: Database,
  input: { projectId: string; slug: string; domain: string },
): Promise<setSiteCustomDomain.Result | undefined> {
  const [site] = await db
    .select()
    .from(projectsites)
    .where(and(eq(projectsites.projectId, input.projectId), eq(projectsites.slug, input.slug)))
  if (!site) return undefined
  if (site.customDomain === input.domain) {
    return { slug: site.slug, customDomain: input.domain, verifiedAt: site.customDomainVerifiedAt }
  }
  const [taken] = await db
    .select({ id: projectsites.id })
    .from(projectsites)
    .where(and(eq(projectsites.customDomain, input.domain), ne(projectsites.id, site.id)))
  if (taken) throw new ConflictError(`${input.domain} is already used by another site`)
  try {
    await db
      .update(projectsites)
      .set({ customDomain: input.domain, customDomainVerifiedAt: null })
      .where(eq(projectsites.id, site.id))
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new ConflictError(`${input.domain} is already used by another site`)
    }
    throw err
  }
  return { slug: site.slug, customDomain: input.domain, verifiedAt: null }
}

/** Releases a site's custom domain. Returns whether the project has such a site. */
export async function clearSiteCustomDomain(
  db: Database,
  input: { projectId: string; slug: string },
): Promise<boolean> {
  const rows = await db
    .update(projectsites)
    .set({ customDomain: null, customDomainVerifiedAt: null })
    .where(and(eq(projectsites.projectId, input.projectId), eq(projectsites.slug, input.slug)))
    .returning({ id: projectsites.id })
  return rows.length > 0
}

/** Records the outcome of a DNS check for the domain a site holds now. */
export async function markSiteCustomDomainVerified(
  db: Database,
  input: { projectId: string; slug: string; domain: string; verified: boolean; now?: Date },
): Promise<void> {
  await db
    .update(projectsites)
    .set({ customDomainVerifiedAt: input.verified ? (input.now ?? new Date()) : null })
    .where(
      and(
        eq(projectsites.projectId, input.projectId),
        eq(projectsites.slug, input.slug),
        eq(projectsites.customDomain, input.domain),
        isNotNull(projectsites.customDomain),
      ),
    )
}
