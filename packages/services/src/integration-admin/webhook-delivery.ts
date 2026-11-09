import { type Database } from '@circi/db'
import { claimDelivery } from '@circi/db/queue'

/**
 * Records that a git host's webhook delivery is being handled. True for the first claim of a
 * delivery id, false for a redelivery (the host retried, or two replicas got the same one): only
 * the first is handled.
 */
export async function claimWebhookDelivery(db: Database, deliveryId: string): Promise<boolean> {
  return db.transaction((tx) => claimDelivery(tx, deliveryId))
}
