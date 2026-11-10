import { and, eq, inArray, sql } from 'drizzle-orm'

import { pushSubscriptions, type PushSubscriptionRow } from '#schema/index.ts'
import type { Database } from '#src/client.ts'

/**
 * Web push subscriptions: one row per browser (the endpoint is unique). Data only: whether to
 * push, and the request to the push service, are `@circi/services`'.
 */

export namespace savePushSubscription {
  export interface Input {
    userId: string
    endpoint: string
    p256dh: string
    auth: string
    userAgent?: string | null
    label: string
  }
}

/**
 * Remembers a browser's subscription. The same endpoint again (the page re-subscribed, or
 * someone else signed in on this browser) takes the new owner and keys and keeps one row.
 */
export async function savePushSubscription(
  db: Database,
  input: savePushSubscription.Input,
): Promise<PushSubscriptionRow> {
  const values = {
    userId: input.userId,
    endpoint: input.endpoint,
    p256dh: input.p256dh,
    auth: input.auth,
    userAgent: input.userAgent ?? null,
    label: input.label,
  }
  const [row] = await db
    .insert(pushSubscriptions)
    .values(values)
    .onConflictDoUpdate({ target: pushSubscriptions.endpoint, set: values })
    .returning()
  if (!row) throw new Error('upsert returned no row')
  return row
}

/** The person's subscriptions, with the keys a push needs, oldest first. */
export async function listPushSubscriptions(
  db: Database,
  userId: string,
): Promise<PushSubscriptionRow[]> {
  return db
    .select()
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.userId, userId))
    .orderBy(pushSubscriptions.createdAt)
}

/** Whether the person has any device that takes push. */
export async function hasPushSubscription(db: Database, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: pushSubscriptions.id })
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.userId, userId))
    .limit(1)
  return row !== undefined
}

/** Removes one of the person's devices by its ID; false when they have no such device. */
export async function deletePushSubscription(
  db: Database,
  input: { userId: string; id: string },
): Promise<boolean> {
  const rows = await db
    .delete(pushSubscriptions)
    .where(and(eq(pushSubscriptions.id, input.id), eq(pushSubscriptions.userId, input.userId)))
    .returning({ id: pushSubscriptions.id })
  return rows.length > 0
}

/** Removes the person's device with this endpoint (this browser, turning push off). */
export async function deletePushSubscriptionByEndpoint(
  db: Database,
  input: { userId: string; endpoint: string },
): Promise<boolean> {
  const rows = await db
    .delete(pushSubscriptions)
    .where(
      and(
        eq(pushSubscriptions.endpoint, input.endpoint),
        eq(pushSubscriptions.userId, input.userId),
      ),
    )
    .returning({ id: pushSubscriptions.id })
  return rows.length > 0
}

/** Removes subscriptions the push service said are gone. */
export async function deletePushSubscriptionsById(db: Database, ids: string[]): Promise<void> {
  if (ids.length === 0) return
  await db.delete(pushSubscriptions).where(inArray(pushSubscriptions.id, ids))
}

/** Every subscription: the keys they were made under no longer exist. */
export async function deleteAllPushSubscriptions(db: Database): Promise<void> {
  await db.delete(pushSubscriptions)
}

/** Records that the push service accepted a push to these subscriptions. */
export async function touchPushSubscriptions(db: Database, ids: string[]): Promise<void> {
  if (ids.length === 0) return
  await db
    .update(pushSubscriptions)
    .set({ lastUsedAt: sql`now()` })
    .where(inArray(pushSubscriptions.id, ids))
}
