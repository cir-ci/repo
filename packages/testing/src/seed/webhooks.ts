import {
  createWebhook,
  type Database,
  type Webhook,
  WEBHOOK_EVENTS,
  type WebhookEvent,
} from '@circi/db'

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
