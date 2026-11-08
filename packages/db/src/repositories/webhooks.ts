import { randomBytes, randomUUID } from 'node:crypto'

import { ValidationError } from '@circi/core'
import { and, desc, eq, inArray, sql } from 'drizzle-orm'

import {
  workspace,
  teams,
  WEBHOOK_EVENTS,
  type WebhookEvent,
  webhookDeliveries,
  webhooks,
} from '#schema/index.ts'
import type { Database } from '#src/client.ts'
import { NotFoundError } from '#src/errors.ts'
import type { Build } from '#src/types.ts'

import { enqueueJob, QUEUES } from './jobs.ts'
import type { ReviewEntry } from './reviews.ts'

/** A team's outgoing webhooks (PLAN §7.4): managing them and queueing the deliveries. */

export { WEBHOOK_EVENTS, type WebhookEvent }

export type Webhook = typeof webhooks.$inferSelect

export function isWebhookEvent(value: string): value is WebhookEvent {
  return (WEBHOOK_EVENTS as readonly string[]).includes(value)
}

export async function createWebhook(
  db: Database,
  input: { teamId: string; url: string; events: readonly WebhookEvent[] },
): Promise<Webhook> {
  // No "empty means every event": a webhook says what it wants to hear.
  if (input.events.length === 0) throw new ValidationError('A webhook needs at least one event')
  const [row] = await db
    .insert(webhooks)
    .values({
      teamId: input.teamId,
      url: input.url,
      secret: `whsec_${randomBytes(24).toString('base64url')}`,
      events: [...new Set(input.events)],
    })
    .returning()
  if (!row) throw new Error('insert returned no row')
  return row
}

export async function listWebhooks(db: Database, teamId: string): Promise<Webhook[]> {
  return db.select().from(webhooks).where(eq(webhooks.teamId, teamId)).orderBy(webhooks.createdAt)
}

export async function getWebhook(db: Database, id: string): Promise<Webhook | undefined> {
  const [row] = await db.select().from(webhooks).where(eq(webhooks.id, id))
  return row
}

export async function deleteWebhook(db: Database, teamId: string, id: string): Promise<void> {
  const deleted = await db
    .delete(webhooks)
    .where(and(eq(webhooks.id, id), eq(webhooks.teamId, teamId)))
    .returning({ id: webhooks.id })
  if (deleted.length === 0) throw new NotFoundError('Webhook not found')
}

export namespace queueWebhookEvent {
  /** What a receiver gets, besides `id`, `event`, `createdAt` and the dashboard `url`. */
  export interface Data {
    workspace: { slug: string }
    team: { id: string; slug: string; name: string }
    build: {
      id: string
      number: number
      name: string
      status: string
      conclusion: string | null
      reviewStatus: string
      commitSha: string
      branch: string | null
      prNumber: number | null
    }
    review?: { state: string; source: string; reviewer: string | null }
  }
}

/**
 * Queues one delivery job per enabled webhook of the build's team that listens to `event`.
 * Call it inside the transaction that changed the build, so a delivery is queued exactly when
 * the change is committed. The body is built when the job runs (it needs the dashboard address).
 */
export async function queueWebhookEvent(
  db: Database,
  input: {
    build: Pick<
      Build,
      | 'id'
      | 'teamId'
      | 'number'
      | 'name'
      | 'status'
      | 'conclusion'
      | 'reviewStatus'
      | 'commitSha'
      | 'branch'
      | 'prNumber'
    >
    event: WebhookEvent
    review?: Pick<ReviewEntry, 'state' | 'source' | 'userName'>
  },
): Promise<number> {
  const { build, event } = input
  const targets = await db
    .select({
      id: webhooks.id,
      teamSlug: teams.slug,
      teamName: teams.name,
      workspaceSlug: workspace.slug,
    })
    .from(webhooks)
    .innerJoin(teams, eq(teams.id, webhooks.teamId))
    .innerJoin(workspace, eq(workspace.id, teams.workspaceId))
    .where(
      and(
        eq(webhooks.teamId, build.teamId),
        eq(webhooks.enabled, true),
        sql`${event} = any(${webhooks.events})`,
      ),
    )
  const createdAt = new Date().toISOString()
  for (const target of targets) {
    const data: queueWebhookEvent.Data = {
      workspace: { slug: target.workspaceSlug },
      team: { id: build.teamId, slug: target.teamSlug, name: target.teamName },
      build: {
        id: build.id,
        number: build.number,
        name: build.name,
        status: build.status,
        conclusion: build.conclusion,
        reviewStatus: build.reviewStatus,
        commitSha: build.commitSha,
        branch: build.branch,
        prNumber: build.prNumber,
      },
      ...(input.review
        ? {
            review: {
              state: input.review.state,
              source: input.review.source,
              reviewer: input.review.userName,
            },
          }
        : {}),
    }
    // oxlint-disable-next-line no-await-in-loop -- a handful of webhooks per team
    await enqueueJob(db, {
      queue: QUEUES.webhook,
      payload: { webhookId: target.id, deliveryId: randomUUID(), event, createdAt, data },
      maxAttempts: 8,
    })
  }
  return targets.length
}

/** The event name of a "Send test" delivery. It is not one of `WEBHOOK_EVENTS`: nobody subscribes to it. */
export const TEST_EVENT = 'webhook.test'

/**
 * Queues one signed test delivery to one webhook, through the same job as a build event (so it
 * is signed, checked and retried the same way). The body carries `test: true` and no build.
 * Returns the delivery id the receiver sees in `CirCI-Delivery`.
 */
export async function queueTestWebhook(db: Database, webhookId: string): Promise<string> {
  const [target] = await db
    .select({
      teamId: webhooks.teamId,
      teamSlug: teams.slug,
      teamName: teams.name,
      workspaceSlug: workspace.slug,
    })
    .from(webhooks)
    .innerJoin(teams, eq(teams.id, webhooks.teamId))
    .innerJoin(workspace, eq(workspace.id, teams.workspaceId))
    .where(eq(webhooks.id, webhookId))
  if (!target) throw new NotFoundError('Webhook not found')
  const deliveryId = randomUUID()
  await enqueueJob(db, {
    queue: QUEUES.webhook,
    payload: {
      webhookId,
      deliveryId,
      event: TEST_EVENT,
      test: true,
      createdAt: new Date().toISOString(),
      data: {
        workspace: { slug: target.workspaceSlug },
        team: { id: target.teamId, slug: target.teamSlug, name: target.teamName },
      },
    },
    maxAttempts: 1,
  })
  return deliveryId
}

export type WebhookDelivery = typeof webhookDeliveries.$inferSelect

/** How many attempts are kept per webhook; the dashboard shows the newest `RECENT_DELIVERIES`. */
const KEPT_DELIVERIES = 50
export const RECENT_DELIVERIES = 20

/** About one insert in this many also prunes: the table stays small without a delete per attempt. */
const PRUNE_ONE_IN = 20

export async function recordWebhookDelivery(
  db: Database,
  input: {
    webhookId: string
    deliveryId: string
    event: string
    test: boolean
    attempt: number
    statusCode: number | null
    error?: string | null
  },
): Promise<void> {
  await db.insert(webhookDeliveries).values({
    ...input,
    error: input.error ? input.error.slice(0, 500) : null,
    // Attempts are ordered by when they happened, even inside one transaction.
    createdAt: sql`clock_timestamp()`,
  })
  if (Math.random() * PRUNE_ONE_IN < 1) await pruneWebhookDeliveries(db, input.webhookId)
}

/** Drops what fell out of the newest `KEPT_DELIVERIES` attempts of a webhook. */
export async function pruneWebhookDeliveries(db: Database, webhookId: string): Promise<void> {
  await db.execute(sql`
    delete from webhook_deliveries where webhook_id = ${webhookId} and id in (
      select id from webhook_deliveries where webhook_id = ${webhookId}
      order by created_at desc, id desc offset ${KEPT_DELIVERIES})`)
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
