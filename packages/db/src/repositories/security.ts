import { createHash } from 'node:crypto'

import { and, count, eq, gt, lt } from 'drizzle-orm'

import type { Database } from '../client.ts'
import { emailCodeRequests, knownDevices } from '../schema/index.ts'

/** Abuse limits and "new sign-in" tracking around email login (PLAN §7.8). */

/**
 * Counts one sign-in code request for `email` and says whether it may go ahead. The count
 * covers every IP, and applies whether or not the address has an account, so the answer never
 * reveals which addresses exist. Refused requests aren't counted again.
 */
export async function takeEmailCodeSlot(
  db: Database,
  email: string,
  options: takeEmailCodeSlot.Options = {},
): Promise<boolean> {
  const address = email.trim().toLowerCase()
  const limit = options.limit ?? 5
  const windowMs = options.windowMs ?? 15 * 60_000
  const since = new Date(Date.now() - windowMs)
  // Old rows only matter inside the window; tidy them as we go.
  await db.delete(emailCodeRequests).where(lt(emailCodeRequests.requestedAt, since))
  const [row] = await db
    .select({ n: count() })
    .from(emailCodeRequests)
    .where(and(eq(emailCodeRequests.email, address), gt(emailCodeRequests.requestedAt, since)))
  if ((row?.n ?? 0) >= limit) return false
  await db.insert(emailCodeRequests).values({ email: address })
  return true
}

export namespace takeEmailCodeSlot {
  export interface Options {
    /** Codes one address may ask for within the window. Default 5. */
    limit?: number
    /** Default 15 minutes. */
    windowMs?: number
  }
}

export const deviceFingerprint = (userAgent: string | null | undefined) =>
  createHash('sha256')
    .update(userAgent ?? '')
    .digest('hex')

/**
 * Remembers a sign-in's device. `first`: the account's very first sign-in (nothing to warn
 * about), `new`: a device not seen before (worth a mail), `known`: seen before.
 */
export async function noteDevice(
  db: Database,
  userId: string,
  fingerprint: string,
): Promise<'first' | 'new' | 'known'> {
  const existing = await db.select().from(knownDevices).where(eq(knownDevices.userId, userId))
  if (existing.some((d) => d.fingerprint === fingerprint)) return 'known'
  await db.insert(knownDevices).values({ userId, fingerprint }).onConflictDoNothing()
  return existing.length === 0 ? 'first' : 'new'
}
