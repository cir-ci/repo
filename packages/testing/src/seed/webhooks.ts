import { createWebhook, type Database, type Webhook, type WebhookEvent } from '@circi/db'

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
    ...(input.events ? { events: input.events } : {}),
  })
}
