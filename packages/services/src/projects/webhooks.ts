import { NotFoundError, ValidationError } from '@circi/core'
import { type WebhookEvent } from '@circi/core/node'
import { type Database } from '@circi/db'
import { type Webhook } from '@circi/db/queries'
import {
  createWebhook,
  deleteWebhook,
  getWebhook,
  queueTestWebhook,
  rotateWebhookSecret,
} from '@circi/db/queue'

/** Adds a webhook to a project; the row carries the signing secret, which is shown only once. */
export async function addWebhook(
  db: Database,
  input: { projectId: string; url: string; events: readonly WebhookEvent[] },
): Promise<Webhook> {
  return db.transaction((tx) => createWebhook(tx, input))
}

/** Removes one of the project's webhooks; "not found" when the project has no such webhook. */
export async function removeWebhook(db: Database, projectId: string, id: string): Promise<void> {
  await db.transaction((tx) => deleteWebhook(tx, projectId, id))
}

/**
 * Replaces a webhook's signing secret and returns the row with the new one, shown only once. The
 * old secret stops signing at once, so receivers fail verification until they are updated.
 */
export async function regenerateWebhookSecret(
  db: Database,
  projectId: string,
  id: string,
): Promise<Webhook> {
  return db.transaction((tx) => rotateWebhookSecret(tx, projectId, id))
}

/**
 * Queues a signed test event to one of the project's webhooks and returns its delivery id. It goes
 * through the delivery job like a build event. A webhook of another project is "not found"; a
 * disabled one is refused.
 */
export async function sendTestWebhook(
  db: Database,
  projectId: string,
  id: string,
): Promise<string> {
  return db.transaction(async (tx) => {
    const hook = await getWebhook(tx, id)
    if (hook?.projectId !== projectId) throw new NotFoundError('Webhook not found')
    if (!hook.enabled) throw new ValidationError('This webhook is disabled')
    return queueTestWebhook(tx, hook.id)
  })
}
