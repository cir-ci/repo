import { verifyWebhookSignature } from '@circi/core/node'

export namespace describeDelivery {
  export interface Input {
    headers: Record<string, string | string[] | undefined>
    body: string
    /** The signing secret the seed saved for this request's path; undefined for a webhook it didn't create. */
    secret: string | undefined
    now?: Date
  }
  export interface Result {
    /** `valid` or `invalid` need the seed's secret for the path; `unchecked` is a webhook the seed didn't create. */
    signature: 'valid' | 'invalid' | 'unchecked' | 'missing'
    line: string
  }
}

const first = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value

/** One short log line for a delivery: event, delivery ID, and whether the signature checks out. */
export function describeDelivery({
  headers,
  body,
  secret,
  now,
}: describeDelivery.Input): describeDelivery.Result {
  const event = first(headers['circi-event']) ?? '(no event)'
  const id = first(headers['circi-delivery']) ?? '(no ID)'
  const header = first(headers['circi-signature'])
  const signature = !header
    ? 'missing'
    : secret === undefined
      ? 'unchecked'
      : verifyWebhookSignature(secret, body, header, now ? { now } : {})
        ? 'valid'
        : 'invalid'
  const text = {
    valid: 'signature valid',
    invalid: 'signature INVALID',
    unchecked: 'signature not checked (webhook not created by the seed)',
    missing: 'no signature',
  }[signature]
  return { signature, line: `${event} ${id} ${text}` }
}

/** The seed's file: a JSON object of signing secrets by the path of the webhook's URL; anything else is none. */
export function parseSecrets(text: string): Record<string, string> {
  try {
    const value: unknown = JSON.parse(text)
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
    return Object.fromEntries(
      Object.entries(value).filter((e): e is [string, string] => typeof e[1] === 'string'),
    )
  } catch {
    return {}
  }
}
