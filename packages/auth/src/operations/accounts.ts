import type { Database } from '@circi/db'
import * as schema from '@circi/db/schema'
import { and, eq, gt, sql } from 'drizzle-orm'

/** Questions about who has an account or an open invitation, asked by sign-in and its hooks. */

/** Whether someone invited this address and the invitation can still be accepted. */
export async function hasPendingInvitation(db: Database, email: string): Promise<boolean> {
  const [row] = await db
    .select({ id: schema.invitation.id })
    .from(schema.invitation)
    .where(
      and(
        sql`lower(${schema.invitation.email}) = ${email.toLowerCase()}`,
        eq(schema.invitation.status, 'pending'),
        gt(schema.invitation.expiresAt, new Date()),
      ),
    )
    .limit(1)
  return row !== undefined
}

export async function hasAccount(db: Database, email: string): Promise<boolean> {
  const [row] = await db
    .select({ id: schema.user.id })
    .from(schema.user)
    .where(sql`lower(${schema.user.email}) = ${email.toLowerCase()}`)
    .limit(1)
  return row !== undefined
}

/** Whether the address belongs to an account that is banned right now (a ban may expire). */
export async function isBanned(db: Database, email: string): Promise<boolean> {
  const [row] = await db
    .select({ banned: schema.user.banned, banExpires: schema.user.banExpires })
    .from(schema.user)
    .where(sql`lower(${schema.user.email}) = ${email.toLowerCase()}`)
    .limit(1)
  if (!row?.banned) return false
  return row.banExpires === null || row.banExpires > new Date()
}
