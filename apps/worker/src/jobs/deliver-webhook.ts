import { lookup } from 'node:dns/promises'

import { isPrivateAddress, signWebhook, webhookUrlProblem } from '@circi/core'
import { type Database, getWebhook, type Job } from '@circi/db'

/** The `webhook` job: one signed delivery of one event to one receiver (PLAN §7.4). */

export namespace deliverWebhook {
  export interface Deps {
    db: Database
    /** The dashboard's origin, for the `url` link in the body. */
    publicOrigin?: string
    /** Replaceable in tests. */
    fetch?: typeof fetch
    timeoutMs?: number
    /** Deliver to private/loopback addresses too (`WEBHOOK_ALLOW_PRIVATE_ADDRESSES`). */
    allowPrivate?: boolean
    /** Resolves a hostname to its addresses; replaceable in tests. */
    resolve?: (host: string) => Promise<string[]>
  }

  export type Result = { status: 'skipped'; reason: string } | { status: 'delivered'; code: number }
}

/** Throws when the receiver doesn't answer 2xx, so the queue retries with backoff. */
export async function deliverWebhook(
  deps: deliverWebhook.Deps,
  job: Job,
): Promise<deliverWebhook.Result> {
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

  if (!deps.allowPrivate) {
    // The address was checked when it was added, but a name can point somewhere else later.
    const problem = webhookUrlProblem(webhook.url)
    const host = new URL(webhook.url).hostname.replace(/^\[|\]$/g, '')
    const addresses = problem ? [] : await (deps.resolve ?? resolveAll)(host)
    if (problem || addresses.some(isPrivateAddress)) {
      return { status: 'skipped', reason: 'webhook address is on a private network' }
    }
  }

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

async function resolveAll(host: string): Promise<string[]> {
  return (await lookup(host, { all: true })).map((a) => a.address)
}
