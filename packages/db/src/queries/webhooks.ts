import { desc, eq, inArray, sql } from 'drizzle-orm'

import { webhookDeliveries, webhooks } from '#schema/index.ts'
import type { Database } from '#src/client.ts'

/** A team's webhooks and the recent attempts to deliver to them. */

export type Webhook = typeof webhooks.$inferSelect

export type WebhookDelivery = typeof webhookDeliveries.$inferSelect

export const RECENT_DELIVERIES = 20

export async function listWebhooks(db: Database, teamId: string): Promise<Webhook[]> {
  return db.select().from(webhooks).where(eq(webhooks.teamId, teamId)).orderBy(webhooks.createdAt)
}

/** The newest attempts (at most `limit`, default 20) of each of the given webhooks, newest first. */
export async function listWebhookDeliveries(
  db: Database,
  webhookIds: readonly string[],
  limit = RECENT_DELIVERIES,
): Promise<Map<string, WebhookDelivery[]>> {
  const byHook = new Map<string, WebhookDelivery[]>(webhookIds.map((id) => [id, []]))
  if (webhookIds.length === 0) return byHook
  const ranked = db
    .select({
      id: webhookDeliveries.id,
      rank: sql<number>`row_number() over (partition by ${webhookDeliveries.webhookId} order by ${webhookDeliveries.createdAt} desc, ${webhookDeliveries.id} desc)`.as(
        'rank',
      ),
    })
    .from(webhookDeliveries)
    .where(inArray(webhookDeliveries.webhookId, [...webhookIds]))
    .as('ranked')
  const rows = await db
    .select({ row: webhookDeliveries })
    .from(webhookDeliveries)
    .innerJoin(ranked, eq(ranked.id, webhookDeliveries.id))
    .where(sql`${ranked.rank} <= ${limit}`)
    .orderBy(desc(webhookDeliveries.createdAt), desc(webhookDeliveries.id))
  for (const { row } of rows) byHook.get(row.webhookId)?.push(row)
  return byHook
}
