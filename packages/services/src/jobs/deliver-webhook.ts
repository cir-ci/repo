import { lookup } from 'node:dns/promises'

import { isPrivateAddress, signWebhook, webhookUrlProblem } from '@circi/core/node'
import { type Database, type Job } from '@circi/db'
import { getWebhook, recordWebhookDelivery } from '@circi/db/queue'

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
    /** Where a failed history write is reported; the delivery never depends on it. */
    warn?: (obj: object, msg: string) => void
  }

  export type Result = { status: 'skipped'; reason: string } | { status: 'delivered'; code: number }
}

/** Throws when the receiver doesn't answer 2xx, so the queue retries with backoff. */
export async function deliverWebhook(
  deps: deliverWebhook.Deps,
  job: Job,
): Promise<deliverWebhook.Result> {
  const { webhookId, deliveryId, event, createdAt, data, test } = job.payload as {
    webhookId?: string
    deliveryId?: string
    event?: string
    createdAt?: string
    /** A "Send test" event: no build, and the body says `test: true`. */
    test?: boolean
    data?: {
      workspace: { slug: string }
      project: { slug: string }
      build?: { number: number }
    }
  }
  if (!webhookId || !deliveryId || !event || !createdAt || !data) {
    return { status: 'skipped', reason: 'malformed job' }
  }
  const isTest = test === true
  // The history is best effort: a failing insert must never change the job's outcome (a delivered
  // event must not be retried, and the network error is what the queue should see).
  const record = async (outcome: { statusCode: number | null; error?: string }) => {
    try {
      await deps.db.transaction((tx) =>
        recordWebhookDelivery(tx, {
          webhookId,
          deliveryId,
          event,
          test: isTest,
          attempt: job.attempts,
          ...outcome,
        }),
      )
    } catch (err) {
      deps.warn?.({ err, webhookId, deliveryId }, 'could not record the webhook delivery')
    }
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
      await record({ statusCode: null, error: 'The address is on a private network' })
      return { status: 'skipped', reason: 'webhook address is on a private network' }
    }
  }

  const link =
    deps.publicOrigin && data.build
      ? {
          url: `${deps.publicOrigin}/${data.workspace.slug}/${data.project.slug}/builds/${data.build.number}`,
        }
      : {}
  const body = JSON.stringify({
    id: deliveryId,
    event,
    createdAt,
    ...(isTest ? { test: true } : {}),
    ...link,
    ...data,
  })
  let response: Response
  try {
    response = await (deps.fetch ?? fetch)(webhook.url, {
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
  } catch (err) {
    await record({ statusCode: null, error: err instanceof Error ? err.message : String(err) })
    throw err
  }
  await record({ statusCode: response.status })
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`${webhook.url} answered ${response.status}`)
  }
  return { status: 'delivered', code: response.status }
}

async function resolveAll(host: string): Promise<string[]> {
  return (await lookup(host, { all: true })).map((a) => a.address)
}
