import { createHmac, timingSafeEqual } from 'node:crypto'

import { ValidationError } from './errors.ts'

/** The events a team webhook can subscribe to. */
export const WEBHOOK_EVENTS = ['build.completed', 'build.reviewed'] as const
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number]

export function isWebhookEvent(value: string): value is WebhookEvent {
  return (WEBHOOK_EVENTS as readonly string[]).includes(value)
}

/** The subscribed events, checked: at least one, all known. Throws `ValidationError` otherwise. */
export function checkWebhookEvents(events: readonly string[]): WebhookEvent[] {
  if (events.length === 0) {
    throw new ValidationError('Choose at least one event for the webhook to receive')
  }
  const unknown = events.filter((e) => !isWebhookEvent(e))
  if (unknown.length > 0) throw new ValidationError(`Unknown event(s): ${unknown.join(', ')}`)
  return events.filter(isWebhookEvent)
}

/**
 * Webhook signatures: `CirCI-Signature: t=<unix seconds>,v1=<hex>`, where `v1` is
 * HMAC-SHA256(secret, `<t>.<raw body>`). The timestamp is signed so a captured request can't be
 * replayed later; receivers should reject signatures older than a few minutes.
 */

export function signWebhook(secret: string, body: string, at: Date = new Date()): string {
  const t = Math.floor(at.getTime() / 1000)
  return `t=${t},v1=${mac(secret, t, body)}`
}

export function verifyWebhookSignature(
  secret: string,
  body: string,
  header: string,
  options: { now?: Date; toleranceSeconds?: number } = {},
): boolean {
  const parts = new Map<string, string>()
  for (const part of header.split(',')) {
    const [key = '', value = ''] = part.trim().split('=')
    parts.set(key, value)
  }
  const t = Number(parts.get('t'))
  const given = parts.get('v1')
  if (!Number.isInteger(t) || !given) return false
  const nowSeconds = (options.now ?? new Date()).getTime() / 1000
  if (Math.abs(nowSeconds - t) > (options.toleranceSeconds ?? 300)) return false
  const expected = Buffer.from(mac(secret, t, body), 'hex')
  const actual = Buffer.from(given, 'hex')
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

function mac(secret: string, t: number, body: string): string {
  return createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')
}
