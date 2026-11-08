import { randomBytes, randomUUID } from 'node:crypto'

import { ValidationError } from '@circi/core'
import { and, eq, sql } from 'drizzle-orm'

import {
  organization,
  projects,
  WEBHOOK_EVENTS,
  type WebhookEvent,
  webhooks,
} from '#schema/index.ts'
import type { Database } from '#src/client.ts'
import { NotFoundError } from '#src/errors.ts'
import type { Build } from '#src/types.ts'

import { enqueueJob, QUEUES } from './jobs.ts'
import type { ReviewEntry } from './reviews.ts'

/** A project's outgoing webhooks (PLAN §7.4): managing them and queueing the deliveries. */

export { WEBHOOK_EVENTS, type WebhookEvent }

export type Webhook = typeof webhooks.$inferSelect

export function isWebhookEvent(value: string): value is WebhookEvent {
  return (WEBHOOK_EVENTS as readonly string[]).includes(value)
}

export async function createWebhook(
  db: Database,
  input: { projectId: string; url: string; events: readonly WebhookEvent[] },
): Promise<Webhook> {
  // No "empty means every event": a webhook says what it wants to hear.
  if (input.events.length === 0) throw new ValidationError('A webhook needs at least one event')
  const [row] = await db
    .insert(webhooks)
    .values({
      projectId: input.projectId,
      url: input.url,
      secret: `whsec_${randomBytes(24).toString('base64url')}`,
      events: [...new Set(input.events)],
    })
    .returning()
  if (!row) throw new Error('insert returned no row')
  return row
}

export async function listWebhooks(db: Database, projectId: string): Promise<Webhook[]> {
  return db
    .select()
    .from(webhooks)
    .where(eq(webhooks.projectId, projectId))
    .orderBy(webhooks.createdAt)
}

export async function getWebhook(db: Database, id: string): Promise<Webhook | undefined> {
  const [row] = await db.select().from(webhooks).where(eq(webhooks.id, id))
  return row
}

export async function deleteWebhook(db: Database, projectId: string, id: string): Promise<void> {
  const deleted = await db
    .delete(webhooks)
    .where(and(eq(webhooks.id, id), eq(webhooks.projectId, projectId)))
    .returning({ id: webhooks.id })
  if (deleted.length === 0) throw new NotFoundError('Webhook not found')
}

export namespace queueWebhookEvent {
  /** What a receiver gets, besides `id`, `event`, `createdAt` and the dashboard `url`. */
  export interface Data {
    organization: { slug: string }
    project: { id: string; slug: string; name: string }
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
 * Queues one delivery job per enabled webhook of the build's project that listens to `event`.
 * Call it inside the transaction that changed the build, so a delivery is queued exactly when
 * the change is committed. The body is built when the job runs (it needs the dashboard address).
 */
export async function queueWebhookEvent(
  db: Database,
  input: {
    build: Pick<
      Build,
      | 'id'
      | 'projectId'
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
      projectSlug: projects.slug,
      projectName: projects.name,
      orgSlug: organization.slug,
    })
    .from(webhooks)
    .innerJoin(projects, eq(projects.id, webhooks.projectId))
    .innerJoin(organization, eq(organization.id, projects.orgId))
    .where(
      and(
        eq(webhooks.projectId, build.projectId),
        eq(webhooks.enabled, true),
        sql`${event} = any(${webhooks.events})`,
      ),
    )
  const createdAt = new Date().toISOString()
  for (const target of targets) {
    const data: queueWebhookEvent.Data = {
      organization: { slug: target.orgSlug },
      project: { id: build.projectId, slug: target.projectSlug, name: target.projectName },
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
    // oxlint-disable-next-line no-await-in-loop -- a handful of webhooks per project
    await enqueueJob(db, {
      queue: QUEUES.webhook,
      payload: { webhookId: target.id, deliveryId: randomUUID(), event, createdAt, data },
      maxAttempts: 8,
    })
  }
  return targets.length
}
