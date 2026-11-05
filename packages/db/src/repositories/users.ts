import { count, eq } from 'drizzle-orm'

import type { Database } from '../client.ts'
import { user } from '../schema/index.ts'

/** Lookups on better-auth's user table that CirCI's own flows need. */

export async function countUsers(db: Database): Promise<number> {
  const [row] = await db.select({ n: count() }).from(user)
  return row?.n ?? 0
}

/** Instance admins (better-auth's `admin` role) can do things no organization role can. */
export async function isInstanceAdmin(db: Database, userId: string): Promise<boolean> {
  const [row] = await db.select({ role: user.role }).from(user).where(eq(user.id, userId))
  return (row?.role ?? '').split(',').includes('admin')
}
