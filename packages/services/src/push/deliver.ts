import { lookup } from 'node:dns/promises'

import {
  encryptPushPayload,
  isPrivateAddress,
  vapidAuthorization,
  type VapidKeys,
  webhookUrlProblem,
} from '@circi/core/node'
import type { Database } from '@circi/db'
import {
  deletePushSubscriptionsById,
  getNotificationEmailData,
  listPushSubscriptions,
  pushPreferenceFor,
  touchPushSubscriptions,
} from '@circi/db/repositories'

import { composePushMessage } from './message.ts'
import { getVapidKeys } from './vapid.ts'

/**
 * Sends one inbox notification to the recipient's devices as web push, from this server with its
 * own VAPID key: no relay. The browser vendor's push service only carries the encrypted payload.
 * Called by the notification job after the email, and it never throws for a push service that
 * says no, so a failed push never makes the job (and the email before it) run again.
 */

export namespace deliverPush {
  export interface Deps {
    db: Database
    /** `BETTER_AUTH_SECRET`: opens the stored VAPID private key. */
    authSecret: string
    /** The operator's keys from the environment (`VAPID_*`), else the ones kept in the database. */
    vapid?: VapidKeys | undefined
    /** The contact the push services may use: a `mailto:` or `https:` address. */
    subject: string
    /** Replaceable in tests: the push service's edge. */
    fetch?: typeof fetch
    timeoutMs?: number
    /** Push to private addresses too (`WEBHOOK_ALLOW_PRIVATE_ADDRESSES`). */
    allowPrivate?: boolean
    /** Resolves a hostname to its addresses; replaceable in tests. */
    resolve?: (host: string) => Promise<string[]>
    now?: () => Date
  }

  export type Result =
    | { status: 'skipped'; reason: string }
    | { status: 'done'; sent: number; removed: number; failed: number }
}

export async function deliverPush(
  deps: deliverPush.Deps,
  notificationId: string,
): Promise<deliverPush.Result> {
  const data = await getNotificationEmailData(deps.db, notificationId)
  if (!data) return { status: 'skipped', reason: 'notification was deleted' }
  const n = data.notification
  const preference = pushPreferenceFor(n.kind)
  if (!preference) return { status: 'skipped', reason: 'this kind is not pushed' }
  // The preference is checked again here: it may have been turned off since the job was queued.
  if (!data.preferences[preference]) return { status: 'skipped', reason: 'opted out' }
  if (n.deletedAt || n.readAt) return { status: 'skipped', reason: 'already handled in the inbox' }
  const subscriptions = await listPushSubscriptions(deps.db, n.userId)
  if (subscriptions.length === 0) return { status: 'skipped', reason: 'no devices' }

  const keys = await getVapidKeys(deps.db, {
    authSecret: deps.authSecret,
    fromEnv: deps.vapid,
  })
  const message = composePushMessage({
    id: n.id,
    kind: n.kind,
    payload: n.payload,
    actorName: data.actorName,
    build: data.build,
  })
  const payload = Buffer.from(JSON.stringify(message))
  const send = deps.fetch ?? fetch
  type Outcome = 'sent' | 'gone' | 'failed'
  const post = async (sub: (typeof subscriptions)[number]): Promise<Outcome> => {
    try {
      if (!deps.allowPrivate && (await onPrivateNetwork(sub.endpoint, deps.resolve)))
        return 'failed'
      const response = await send(sub.endpoint, {
        method: 'POST',
        headers: {
          authorization: vapidAuthorization({
            endpoint: sub.endpoint,
            keys,
            subject: deps.subject,
            ...(deps.now ? { now: deps.now() } : {}),
          }),
          'content-encoding': 'aes128gcm',
          'content-type': 'application/octet-stream',
          ttl: '86400',
          urgency: 'normal',
        },
        body: encryptPushPayload({ p256dh: sub.p256dh, auth: sub.auth }, payload),
        // The push service answers directly; a redirect would send the payload elsewhere.
        redirect: 'manual',
        signal: AbortSignal.timeout(deps.timeoutMs ?? 10_000),
      })
      if (response.status >= 200 && response.status < 300) return 'sent'
      return response.status === 404 || response.status === 410 ? 'gone' : 'failed'
    } catch {
      return 'failed'
    }
  }
  const outcomes = await Promise.all(subscriptions.map(post))
  const idsWhere = (outcome: Outcome) =>
    subscriptions.filter((_, i) => outcomes[i] === outcome).map((sub) => sub.id)
  const sent = idsWhere('sent')
  const gone = idsWhere('gone')
  const failed = idsWhere('failed').length
  await deps.db.transaction(async (tx) => {
    await touchPushSubscriptions(tx, sent)
    await deletePushSubscriptionsById(tx, gone)
  })
  return { status: 'done', sent: sent.length, removed: gone.length, failed }
}

/** The address was checked when the device was added, but a name can point somewhere else later. */
async function onPrivateNetwork(
  endpoint: string,
  resolve: ((host: string) => Promise<string[]>) | undefined,
): Promise<boolean> {
  if (webhookUrlProblem(endpoint)) return true
  const host = new URL(endpoint).hostname.replace(/^\[|\]$/g, '')
  const addresses = await (resolve ?? resolveAll)(host)
  return addresses.some(isPrivateAddress)
}

async function resolveAll(host: string): Promise<string[]> {
  return (await lookup(host, { all: true })).map((a) => a.address)
}
