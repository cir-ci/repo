import { count, eq, isNotNull } from 'drizzle-orm'

import { account, user } from '#schema/index.ts'
import type { Database } from '#src/client.ts'

/** Lookups on better-auth's user table that CirCI's own flows need. */

export async function countUsers(db: Database): Promise<number> {
  const [row] = await db.select({ n: count() }).from(user)
  return row?.n ?? 0
}

/** Instance admins (better-auth's `admin` role) can do things no workspace role can. */
export async function isInstanceAdmin(db: Database, userId: string): Promise<boolean> {
  const [row] = await db.select({ role: user.role }).from(user).where(eq(user.id, userId))
  return (row?.role ?? '').split(',').includes('admin')
}

export namespace listInstanceAdminSignIns {
  export interface Item {
    userId: string
    /** Has a password to sign in with. */
    hasPassword: boolean
    /** The single sign-on providers they have an account linked to (`github`, `oidc`, …). */
    providers: string[]
  }
}

/**
 * How each instance admin who isn't banned could sign in, from the accounts they have: a password
 * and the providers they are linked to. Email codes need no account (any address gets one).
 */
export async function listInstanceAdminSignIns(
  db: Database,
): Promise<listInstanceAdminSignIns.Item[]> {
  const admins = await db
    .select({ id: user.id, role: user.role, banned: user.banned })
    .from(user)
    .where(isNotNull(user.role))
  const ids = admins.filter((a) => !a.banned && (a.role ?? '').split(',').includes('admin'))
  if (ids.length === 0) return []
  const accounts = await db
    .select({ userId: account.userId, providerId: account.providerId, password: account.password })
    .from(account)
  const byUser = new Map<string, listInstanceAdminSignIns.Item>(
    ids.map((a) => [a.id, { userId: a.id, hasPassword: false, providers: [] }]),
  )
  for (const row of accounts) {
    const item = byUser.get(row.userId)
    if (!item) continue
    if (row.providerId === 'credential') {
      if (row.password) item.hasPassword = true
    } else item.providers.push(row.providerId)
  }
  return [...byUser.values()]
}
