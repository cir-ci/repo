import type { WebhookReceiver } from '#fakes/webhook-receiver.ts'
import type { Stack } from '#stack/stack.ts'

/** What the webhook tests read back from the stack: the queue's rows and the worker's log. */

export interface WebhookJobRow {
  status: string
  attempts: number
  error: string
  /** Seconds until the job is due again (negative: already due). */
  dueIn: number
}

export const hookJobs = async (stack: Stack, webhookId: string): Promise<WebhookJobRow[]> =>
  (
    await stack.sql(
      `select status, attempts, coalesce(last_error, ''), extract(epoch from (run_at - now()))::int
       from jobs where queue = 'webhook' and payload->>'webhookId' = '${webhookId}' order by id`,
    )
  ).map(([status = '', attempts = '0', error = '', dueIn = '0']) => ({
    status,
    attempts: Number(attempts),
    error,
    dueIn: Number(dueIn),
  }))

/** The worker's log lines about one webhook's failed deliveries (they survive the job's own rows changing). */
export const failures = async (stack: Stack, webhookId: string) =>
  (await stack.logs('circi'))
    .split('\n')
    .filter((l) => l.includes(webhookId) && l.includes('webhook delivery failed'))
    .map((l) => String((JSON.parse(l.slice(l.indexOf('{'))) as { err?: string }).err))

export const disableWebhooks = (stack: Stack, ...ids: string[]) =>
  stack.sql(
    `update webhooks set enabled = false where id in (${ids.map((i) => `'${i}'`).join(',')})`,
  )

/** Milliseconds between each delivery a receiver got and the one before. */
export const gapsOf = (r: WebhookReceiver) =>
  r.deliveries
    .slice(1)
    .map((d, i) => d.receivedAt.getTime() - (r.deliveries[i]?.receivedAt.getTime() ?? 0))
