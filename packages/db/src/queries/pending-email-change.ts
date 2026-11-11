import { and, eq, gt, sql } from 'drizzle-orm'

import { user, verification } from '#schema/index.ts'
import type { Database } from '#src/client.ts'

/**
 * The identifier under which a person's requested email change is remembered in better-auth's
 * `verification` table (its confirmation link is a signed token, so nothing else records that a
 * change is waiting). One per account; written through better-auth's adapter, read here.
 */
export const emailChangeIdentifier = (userId: string): string => `circi:email-change:${userId}`

/** The address a person asked to change to and hasn't confirmed yet, or null (also once the link expired). */
export async function getPendingEmailChange(db: Database, userId: string): Promise<string | null> {
  const [row] = await db
    .select({ value: verification.value })
    .from(verification)
    .where(
      and(
        eq(verification.identifier, emailChangeIdentifier(userId)),
        gt(verification.expiresAt, new Date()),
      ),
    )
    .limit(1)
  return row?.value ?? null
}

/** Whether an account (other than `exceptUserId`) already uses this address, ignoring case. */
export async function isEmailTaken(
  db: Database,
  email: string,
  exceptUserId?: string,
): Promise<boolean> {
  const rows = await db
    .select({ id: user.id })
    .from(user)
    .where(sql`lower(${user.email}) = ${email.trim().toLowerCase()}`)
    .limit(2)
  return rows.some((r) => r.id !== exceptUserId)
}

/** An account's current email address, or undefined when there is no such account. */
export async function getAccountEmail(db: Database, userId: string): Promise<string | undefined> {
  const [row] = await db.select({ email: user.email }).from(user).where(eq(user.id, userId))
  return row?.email
}
