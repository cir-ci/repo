import { randomBytes } from 'node:crypto'
import { resolveTxt } from 'node:dns/promises'

import { ValidationError } from '@circi/core'
import { and, asc, eq, isNotNull } from 'drizzle-orm'

import { orgDomains } from '#schema/index.ts'
import type { Database } from '#src/client.ts'
import { ConflictError, isUniqueViolation, NotFoundError } from '#src/errors.ts'

/** Email domains an organization claims, and the DNS proof that makes a claim count (PLAN §7.8). */

export type OrgDomain = typeof orgDomains.$inferSelect

/** The DNS name that must hold the verification token. */
export const verificationName = (domain: string) => `_circi-verify.${domain}`

/** What the TXT record must contain. */
export const verificationValue = (domain: OrgDomain) => `circi-verify=${domain.verificationToken}`

const DOMAIN_RE = /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/

export function normalizeDomain(raw: string): string {
  const domain = raw.trim().toLowerCase().replace(/^@/, '').replace(/\.$/, '')
  if (!DOMAIN_RE.test(domain)) {
    throw new ValidationError('Enter a domain such as example.com (no address or path)')
  }
  return domain
}

export async function addOrgDomain(db: Database, orgId: string, raw: string): Promise<OrgDomain> {
  const domain = normalizeDomain(raw)
  try {
    const [row] = await db
      .insert(orgDomains)
      .values({ orgId, domain, verificationToken: randomBytes(18).toString('base64url') })
      .returning()
    if (!row) throw new Error('insert returned no row')
    return row
  } catch (err) {
    if (isUniqueViolation(err)) throw new ConflictError(`${domain} is already on this list`)
    throw err
  }
}

export async function listOrgDomains(db: Database, orgId: string): Promise<OrgDomain[]> {
  return db
    .select()
    .from(orgDomains)
    .where(eq(orgDomains.orgId, orgId))
    .orderBy(asc(orgDomains.domain))
}

export async function removeOrgDomain(db: Database, orgId: string, id: string): Promise<void> {
  const rows = await db
    .delete(orgDomains)
    .where(and(eq(orgDomains.orgId, orgId), eq(orgDomains.id, id)))
    .returning({ id: orgDomains.id })
  if (rows.length === 0) throw new NotFoundError('Domain not found')
}

/** Looks up TXT records; replaceable in tests. */
export type TxtResolver = (name: string) => Promise<string[][]>

/**
 * Checks the DNS proof and, if it's there, marks the domain verified. Returns whether it is
 * (a missing record is "not yet", not an error: DNS takes time to spread).
 */
export async function verifyOrgDomain(
  db: Database,
  orgId: string,
  id: string,
  lookup: TxtResolver = resolveTxt,
): Promise<boolean> {
  const [row] = await db
    .select()
    .from(orgDomains)
    .where(and(eq(orgDomains.orgId, orgId), eq(orgDomains.id, id)))
  if (!row) throw new NotFoundError('Domain not found')
  if (row.verifiedAt) return true
  const records = await lookup(verificationName(row.domain)).catch(() => [] as string[][])
  const expected = verificationValue(row)
  // A long TXT value arrives split into chunks; join them back together.
  if (!records.some((chunks) => chunks.join('') === expected)) return false
  try {
    await db.update(orgDomains).set({ verifiedAt: new Date() }).where(eq(orgDomains.id, row.id))
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new ConflictError(`${row.domain} is already verified by another organization`)
    }
    throw err
  }
  return true
}

/** Organizations whose *verified* domain list contains the address's domain. */
export async function organizationsForEmailDomain(
  db: Database,
  email: string,
): Promise<{ orgId: string; role: 'member' }[]> {
  const domain = email.trim().toLowerCase().split('@')[1]
  if (!domain) return []
  const rows = await db
    .select({ orgId: orgDomains.orgId })
    .from(orgDomains)
    .where(and(eq(orgDomains.domain, domain), isNotNull(orgDomains.verifiedAt)))
  return rows.map((r) => ({ orgId: r.orgId, role: 'member' as const }))
}
