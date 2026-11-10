import { describeDevice, NotFoundError, ValidationError } from '@circi/core'
import { webhookUrlProblem } from '@circi/core/node'
import { type Database } from '@circi/db'
import {
  deletePushSubscription,
  deletePushSubscriptionByEndpoint,
  savePushSubscription,
} from '@circi/db/repositories'

/** A person's devices that take web push: turning one on, off, and removing another one. */

export namespace subscribePush {
  export interface Input {
    userId: string
    /** From the browser's `PushSubscription`. */
    endpoint: string
    p256dh: string
    auth: string
    /** The request's `User-Agent`, for the device's name. */
    userAgent?: string | null | undefined
    /** Accept push services on private addresses (`WEBHOOK_ALLOW_PRIVATE_ADDRESSES`; tests, dev). */
    allowPrivate?: boolean | undefined
  }
}

/** Remembers this browser as a device of the person; the same browser again keeps one row. */
export async function subscribePush(db: Database, input: subscribePush.Input) {
  // The server will POST to this address, so it must be a public https one.
  const problem = webhookUrlProblem(input.endpoint, { allowPrivate: input.allowPrivate === true })
  if (problem || (!input.allowPrivate && !input.endpoint.startsWith('https://'))) {
    throw new ValidationError('The push address is not valid', {
      fields: { endpoint: problem ?? 'Use an https address' },
    })
  }
  if (Buffer.from(input.p256dh, 'base64url').length !== 65) {
    throw new ValidationError('The push key is not valid', { fields: { 'keys.p256dh': 'Invalid' } })
  }
  if (Buffer.from(input.auth, 'base64url').length !== 16) {
    throw new ValidationError('The push key is not valid', { fields: { 'keys.auth': 'Invalid' } })
  }
  return db.transaction((tx) =>
    savePushSubscription(tx, {
      userId: input.userId,
      endpoint: input.endpoint,
      p256dh: input.p256dh,
      auth: input.auth,
      userAgent: input.userAgent ?? null,
      label: describeDevice(input.userAgent),
    }),
  )
}

/** Turns push off for this browser. Nothing to do when it was not on. */
export async function unsubscribePush(
  db: Database,
  input: { userId: string; endpoint: string },
): Promise<void> {
  await db.transaction((tx) => deletePushSubscriptionByEndpoint(tx, input))
}

/** Removes one of the person's other devices by its ID. */
export async function removePushDevice(
  db: Database,
  input: { userId: string; id: string },
): Promise<void> {
  const removed = await db.transaction((tx) => deletePushSubscription(tx, input))
  if (!removed) throw new NotFoundError('Device not found')
}
