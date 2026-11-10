import type { Push } from '@circi/api'

import { getJson, post } from '#lib/http.ts'
import type { PushPermission } from '#lib/prompt-rules.ts'
import { usePwaStore } from '#lib/stores/pwa-store.ts'

/**
 * This browser's side of web push: asking permission, subscribing with the server's key, telling
 * the server, and the reverse. The browser's own parts sit behind `PushEnv`, so tests replace
 * them (a real push service can't be reached from a test); the rest is the real requests.
 */

export interface PushEnv {
  /** Whether this browser has service workers, push and notifications, and the worker is registered. */
  supported(): Promise<boolean>
  permission(): PushPermission
  requestPermission(): Promise<PushPermission>
  /** The subscription this browser already has, if any. */
  current(): Promise<Push.SubscribeBody | null>
  /** Subscribes with the server's public key (replacing one made under another key). */
  subscribe(publicKey: string): Promise<Push.SubscribeBody>
  /** Drops this browser's subscription. */
  unsubscribe(): Promise<void>
}

function toBody(subscription: PushSubscription): Push.SubscribeBody {
  const json = subscription.toJSON()
  const { p256dh, auth } = json.keys ?? {}
  if (!json.endpoint || !p256dh || !auth)
    throw new Error('The browser made an incomplete push subscription')
  return { endpoint: json.endpoint, keys: { p256dh, auth } }
}

/** The server's key as `applicationServerKey` takes it. */
export function base64urlToBytes(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(binary, (c) => c.charCodeAt(0))
}

const registration = async () =>
  'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : undefined

export const browserPushEnv: PushEnv = {
  async supported() {
    return (
      'PushManager' in window && 'Notification' in window && (await registration()) !== undefined
    )
  },
  permission() {
    return 'Notification' in window ? Notification.permission : 'unsupported'
  },
  async requestPermission() {
    return await Notification.requestPermission()
  },
  async current() {
    const sub = await (await registration())?.pushManager.getSubscription()
    return sub ? toBody(sub) : null
  },
  async subscribe(publicKey) {
    const reg = await registration()
    if (!reg) throw new Error('The app is not installed as a service worker here')
    // A subscription made under another server key (the instance's keys changed) can't be reused.
    await (await reg.pushManager.getSubscription())?.unsubscribe()
    return toBody(
      await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: base64urlToBytes(publicKey),
      }),
    )
  },
  async unsubscribe() {
    await (await (await registration())?.pushManager.getSubscription())?.unsubscribe()
  },
}

let env: PushEnv = browserPushEnv

/** Replaces the browser's push parts (tests); no argument puts the browser's back. */
export function setPushEnv(next: PushEnv = browserPushEnv): void {
  env = next
}

/** Reads this browser's push state into the store: permission and the endpoint when subscribed. */
export async function refreshPushState(): Promise<void> {
  const { setPush } = usePwaStore.getState()
  if (!(await env.supported())) return setPush({ permission: 'unsupported', endpoint: null })
  const permission = env.permission()
  const current = permission === 'granted' ? await env.current().catch(() => null) : null
  setPush({ permission, endpoint: current?.endpoint ?? null })
}

export type TurnOn = { ok: true } | { ok: false; reason: 'denied' | 'failed' }

/**
 * Turns push on for this browser: asks the browser's permission (only here, after the person
 * chose to), subscribes with the server's key and registers the device. A refusal is
 * remembered by the browser, which will not ask again; the store then says `denied`.
 */
export async function turnOnPush(): Promise<TurnOn> {
  const permission = await env.requestPermission()
  usePwaStore.getState().setPush({ permission, endpoint: null })
  if (permission !== 'granted') return { ok: false, reason: 'denied' }
  const { publicKey } = await getJson<Push.PublicKey>('/api/push/public-key')
  const subscription = await env.subscribe(publicKey)
  await post<Push.Devices>('/api/push/subscribe', subscription)
  usePwaStore.getState().setPush({ permission, endpoint: subscription.endpoint })
  return { ok: true }
}

/** Turns push off for this browser, here and on the server. */
export async function turnOffPush(): Promise<void> {
  const { pushEndpoint, pushPermission, setPush } = usePwaStore.getState()
  const endpoint = pushEndpoint ?? (await env.current().catch(() => null))?.endpoint
  await env.unsubscribe()
  if (endpoint) await post('/api/push/unsubscribe', { endpoint })
  setPush({ permission: pushPermission, endpoint: null })
}
