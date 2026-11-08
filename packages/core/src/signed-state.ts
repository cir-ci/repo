import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * A small signed, expiring token for the `state` of an OAuth redirect: it carries the values the
 * callback needs (which workspace, which user) and proves CirCI issued it. `<payload>.<mac>`,
 * both base64url; the payload is JSON `{ ...claims, exp }` with `exp` in epoch milliseconds. The
 * key is derived from the instance secret, separate from the key that seals credentials.
 */

const mac = (secret: string, payload: string) =>
  createHmac('sha256', `circi-oauth-state:${secret}`).update(payload).digest()

export function signState(
  secret: string,
  claims: Record<string, string>,
  options: { now?: number; ttlMs?: number } = {},
): string {
  const exp = (options.now ?? Date.now()) + (options.ttlMs ?? 10 * 60_000)
  const payload = Buffer.from(JSON.stringify({ ...claims, exp })).toString('base64url')
  return `${payload}.${mac(secret, payload).toString('base64url')}`
}

/** The claims, or undefined when the token is malformed, forged or expired. */
export function verifyState(
  secret: string,
  token: string,
  options: { now?: number } = {},
): Record<string, string> | undefined {
  const [payload, given, ...rest] = token.split('.')
  if (!payload || !given || rest.length > 0) return undefined
  const expected = mac(secret, payload)
  const actual = Buffer.from(given, 'base64url')
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return undefined
  try {
    const parsed: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined
    const { exp, ...claims }: Record<string, unknown> = Object.fromEntries(Object.entries(parsed))
    if (typeof exp !== 'number' || (options.now ?? Date.now()) > exp) return undefined
    const strings: Record<string, string> = {}
    for (const [k, v] of Object.entries(claims)) {
      if (typeof v !== 'string') return undefined
      strings[k] = v
    }
    return strings
  } catch {
    return undefined
  }
}
