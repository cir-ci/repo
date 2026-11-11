import { type Webhook } from '#queries/index.ts'
import { createWebhook } from '#queue/index.ts'
import { WEBHOOK_EVENTS, type WebhookEvent } from '#schema/index.ts'
import { type Database } from '#src/index.ts'

let n = 0

/** An enabled webhook of `projectId` for every event unless `events` narrows it. */
export function seedWebhook(
  db: Database,
  projectId: string,
  input: { url?: string; events?: readonly WebhookEvent[] } = {},
): Promise<Webhook> {
  n += 1
  return createWebhook(db, {
    projectId,
    url: input.url ?? `https://hooks.example.com/${n}`,
    events: input.events ?? WEBHOOK_EVENTS,
  })
}
