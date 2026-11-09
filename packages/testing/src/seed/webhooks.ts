import { type Database } from '@circi/db'
import { type Webhook } from '@circi/db/queries'
import { createWebhook } from '@circi/db/queue'
import { WEBHOOK_EVENTS, type WebhookEvent } from '@circi/db/schema'

let n = 0

/** An enabled webhook of `teamId` for every event unless `events` narrows it. */
export function seedWebhook(
  db: Database,
  teamId: string,
  input: { url?: string; events?: readonly WebhookEvent[] } = {},
): Promise<Webhook> {
  n += 1
  return createWebhook(db, {
    teamId,
    url: input.url ?? `https://hooks.example.com/${n}`,
    events: input.events ?? WEBHOOK_EVENTS,
  })
}
