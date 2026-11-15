import { verifyWebhookSignature } from '@circi/core/node'

export namespace describeDelivery {
  export interface Input {
    headers: Record<string, string | string[] | undefined>
    body: string
    /** The signing secrets of the seeded webhooks; empty when none is known. */
    secrets: readonly string[]
    now?: Date
  }
  export interface Result {
    /** `valid` or `invalid` need a known secret; `unknown` is a signature nothing could be checked against. */
    signature: 'valid' | 'invalid' | 'unknown' | 'missing'
    line: string
  }
}

const first = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value

/** One short log line for a delivery: event, delivery ID, and whether the signature checks out. */
export function describeDelivery({
  headers,
  body,
  secrets,
  now,
}: describeDelivery.Input): describeDelivery.Result {
  const event = first(headers['circi-event']) ?? '(no event)'
  const id = first(headers['circi-delivery']) ?? '(no ID)'
  const header = first(headers['circi-signature'])
  const signature = !header
    ? 'missing'
    : secrets.length === 0
      ? 'unknown'
      : secrets.some((s) => verifyWebhookSignature(s, body, header, now ? { now } : {}))
        ? 'valid'
        : 'invalid'
  const text = {
    valid: 'signature valid',
    invalid: 'signature INVALID',
    unknown: 'signature present (no secret to check it)',
    missing: 'no signature',
  }[signature]
  return { signature, line: `${event} ${id} ${text}` }
}

/** The secrets in the seed's file (a JSON array of strings); anything else is none. */
export function parseSecrets(text: string): string[] {
  try {
    const value: unknown = JSON.parse(text)
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
  } catch {
    return []
  }
}
