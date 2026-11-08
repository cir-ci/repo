import { randomBytes } from 'node:crypto'
import { resolveTxt } from 'node:dns/promises'

import { ValidationError } from '@circi/core'
import { and, asc, eq, isNotNull } from 'drizzle-orm'

import { workspaceDomains } from '#schema/index.ts'
import type { Database } from '#src/client.ts'
import { ConflictError, isUniqueViolation, NotFoundError } from '#src/errors.ts'

import { workspaceAccepts, type SessionMethod } from './auth-settings.ts'

/** Email domains a workspace claims, and the DNS proof that makes a claim count (PLAN §7.8). */

export type WorkspaceDomain = typeof workspaceDomains.$inferSelect

/** The DNS name that must hold the verification token. */
export const verificationName = (domain: string) => `_circi-verify.${domain}`

/** What the TXT record must contain. */
export const verificationValue = (domain: WorkspaceDomain) =>
  `circi-verify=${domain.verificationToken}`

const DOMAIN_RE = /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/

export function normalizeDomain(raw: string): string {
  const domain = raw.trim().toLowerCase().replace(/^@/, '').replace(/\.$/, '')
  if (!DOMAIN_RE.test(domain)) {
    throw new ValidationError('Enter a domain such as example.com (no address or path)')
  }
  return domain
}

export async function addWorkspaceDomain(
  db: Database,
  workspaceId: string,
  raw: string,
): Promise<WorkspaceDomain> {
  const domain = normalizeDomain(raw)
  try {
    const [row] = await db
      .insert(workspaceDomains)
      .values({ workspaceId, domain, verificationToken: randomBytes(18).toString('base64url') })
      .returning()
    if (!row) throw new Error('insert returned no row')
    return row
  } catch (err) {
    if (isUniqueViolation(err)) throw new ConflictError(`${domain} is already on this list`)
    throw err
  }
}

export async function listWorkspaceDomains(
  db: Database,
  workspaceId: string,
): Promise<WorkspaceDomain[]> {
  return db
    .select()
    .from(workspaceDomains)
    .where(eq(workspaceDomains.workspaceId, workspaceId))
    .orderBy(asc(workspaceDomains.domain))
}

export async function removeWorkspaceDomain(
  db: Database,
  workspaceId: string,
  id: string,
): Promise<void> {
  const rows = await db
    .delete(workspaceDomains)
    .where(and(eq(workspaceDomains.workspaceId, workspaceId), eq(workspaceDomains.id, id)))
    .returning({ id: workspaceDomains.id })
  if (rows.length === 0) throw new NotFoundError('Domain not found')
}

/** Looks up TXT records; replaceable in tests. */
export type TxtResolver = (name: string) => Promise<string[][]>

/**
 * Checks the DNS proof and, if it's there, marks the domain verified. Returns whether it is
 * (a missing record is "not yet", not an error: DNS takes time to spread).
 */
export async function verifyWorkspaceDomain(
  db: Database,
  workspaceId: string,
  id: string,
  lookup: TxtResolver = resolveTxt,
): Promise<boolean> {
  const [row] = await db
    .select()
    .from(workspaceDomains)
    .where(and(eq(workspaceDomains.workspaceId, workspaceId), eq(workspaceDomains.id, id)))
  if (!row) throw new NotFoundError('Domain not found')
  if (row.verifiedAt) return true
  const records = await lookup(verificationName(row.domain)).catch(() => [] as string[][])
  const expected = verificationValue(row)
  // A long TXT value arrives split into chunks; join them back together.
  if (!records.some((chunks) => chunks.join('') === expected)) return false
  try {
    await db
      .update(workspaceDomains)
      .set({ verifiedAt: new Date() })
      .where(eq(workspaceDomains.id, row.id))
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new ConflictError(`${row.domain} is already verified by another workspace`)
    }
    throw err
  }
  return true
}

/**
 * Workspaces whose *verified* domain list contains the address's domain, not deleted, and (with
 * `method`) whose sign-in switches accept how the person signed in.
 */
export async function workspacesForEmailDomain(
  db: Database,
  email: string,
  method?: SessionMethod,
): Promise<{ workspaceId: string; role: 'member' }[]> {
  const domain = email.trim().toLowerCase().split('@')[1]
  if (!domain) return []
  const rows = await db
    .select({ workspaceId: workspaceDomains.workspaceId })
    .from(workspaceDomains)
    .where(
      and(
        eq(workspaceDomains.domain, domain),
        isNotNull(workspaceDomains.verifiedAt),
        workspaceAccepts(workspaceDomains.workspaceId, method),
      ),
    )
  return rows.map((r) => ({ workspaceId: r.workspaceId, role: 'member' as const }))
}
