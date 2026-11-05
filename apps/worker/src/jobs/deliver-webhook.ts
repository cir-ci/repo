import { signWebhook } from '@circi/core'
import { type Database, getWebhook, type Job } from '@circi/db'

/** The `webhook` job: one signed delivery of one event to one receiver (PLAN §7.4). */

export interface DeliverDeps {
  db: Database
  /** The dashboard's origin, for the `url` link in the body. */
  publicOrigin?: string
  /** Replaceable in tests. */
  fetch?: typeof fetch
  timeoutMs?: number
}

export type DeliverResult =
  | { status: 'skipped'; reason: string }
  | { status: 'delivered'; code: number }

/** Throws when the receiver doesn't answer 2xx, so the queue retries with backoff. */
export async function deliverWebhook(deps: DeliverDeps, job: Job): Promise<DeliverResult> {
  const { webhookId, deliveryId, event, createdAt, data } = job.payload as {
    webhookId?: string
    deliveryId?: string
    event?: string
    createdAt?: string
    data?: { organization: { slug: string }; project: { slug: string }; build: { number: number } }
  }
  if (!webhookId || !deliveryId || !event || !createdAt || !data) {
    return { status: 'skipped', reason: 'malformed job' }
  }
  const webhook = await getWebhook(deps.db, webhookId)
  if (!webhook) return { status: 'skipped', reason: 'webhook was deleted' }
  if (!webhook.enabled) return { status: 'skipped', reason: 'webhook is disabled' }

  const link = deps.publicOrigin
    ? {
        url: `${deps.publicOrigin}/${data.organization.slug}/${data.project.slug}/builds/${data.build.number}`,
      }
    : {}
  const body = JSON.stringify({ id: deliveryId, event, createdAt, ...link, ...data })
  const response = await (deps.fetch ?? fetch)(webhook.url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'user-agent': 'CirCI-Webhook',
      'circi-event': event,
      'circi-delivery': deliveryId,
      'circi-signature': signWebhook(webhook.secret, body),
    },
    body,
    // A redirect could send the signed body somewhere the owner never configured.
    redirect: 'manual',
    signal: AbortSignal.timeout(deps.timeoutMs ?? 10_000),
  })
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`${webhook.url} answered ${response.status}`)
  }
  return { status: 'delivered', code: response.status }
}
