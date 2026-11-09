import { NotFoundError, ValidationError } from '@circi/core'
import { type WebhookEvent } from '@circi/core/node'
import { type Database } from '@circi/db'
import { type Webhook } from '@circi/db/queries'
import { createWebhook, deleteWebhook, getWebhook, queueTestWebhook } from '@circi/db/queue'

/** Adds a webhook to a team; the row carries the signing secret, which is shown only once. */
export async function addWebhook(
  db: Database,
  input: { teamId: string; url: string; events: readonly WebhookEvent[] },
): Promise<Webhook> {
  return db.transaction((tx) => createWebhook(tx, input))
}

/** Removes one of the team's webhooks; "not found" when the team has no such webhook. */
export async function removeWebhook(db: Database, teamId: string, id: string): Promise<void> {
  await db.transaction((tx) => deleteWebhook(tx, teamId, id))
}

/**
 * Queues a signed test event to one of the team's webhooks and returns its delivery id. It goes
 * through the delivery job like a build event. A webhook of another team is "not found"; a
 * disabled one is refused.
 */
export async function sendTestWebhook(db: Database, teamId: string, id: string): Promise<string> {
  return db.transaction(async (tx) => {
    const hook = await getWebhook(tx, id)
    if (hook?.teamId !== teamId) throw new NotFoundError('Webhook not found')
    if (!hook.enabled) throw new ValidationError('This webhook is disabled')
    return queueTestWebhook(tx, hook.id)
  })
}
