import { isIP } from 'node:net'

/**
 * Where a webhook may point (PLAN §7.4). A receiver on the server's own network (localhost,
 * a metadata endpoint, a database host) is a way to make the server call things the person
 * adding the webhook can't reach themselves, so only public addresses are allowed unless the
 * instance sets `WEBHOOK_ALLOW_PRIVATE_ADDRESSES`.
 */

function ipv4Octets(address: string): number[] | undefined {
  const parts = address.split('.').map(Number)
  return parts.length === 4 && parts.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)
    ? parts
    : undefined
}

/** Loopback, private, link-local (cloud metadata), shared, multicast and reserved addresses. */
export function isPrivateAddress(address: string): boolean {
  const bare = address.replace(/^\[|\]$/g, '').toLowerCase()
  const kind = isIP(bare)
  if (kind === 4) {
    const [a = 0, b = 0, c = 0] = ipv4Octets(bare) ?? []
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 0 && c === 0) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19))
    )
  }
  if (kind === 6) {
    const mapped = /^(?:::ffff:|::)(\d+\.\d+\.\d+\.\d+)$/.exec(bare)
    if (mapped?.[1]) return isPrivateAddress(mapped[1])
    if (bare === '::' || bare === '::1') return true
    const first = Number.parseInt(bare.split(':')[0] || '0', 16)
    // fc00::/7 unique local, fe80::/10 link-local, ff00::/8 multicast
    return (first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80 || (first & 0xff00) === 0xff00
  }
  return false
}

/** A reason the URL can't be used, or `undefined` when it's fine. Names are checked again at delivery. */
export function webhookUrlProblem(
  raw: string,
  options: { allowPrivate?: boolean } = {},
): string | undefined {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return 'Enter a full address such as https://hooks.example.com/circi'
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return 'Use an http or https address'
  if (url.username || url.password)
    return 'Put credentials in a header on the receiver, not in the address'
  if (options.allowPrivate) return undefined
  const host = url.hostname.toLowerCase().replace(/\.$/, '')
  const literal = host.replace(/^\[|\]$/g, '')
  if (isIP(literal)) {
    return isPrivateAddress(literal) ? 'That address is on a private network' : undefined
  }
  if (
    !host.includes('.') ||
    host === 'localhost' ||
    ['.localhost', '.local', '.internal', '.lan', '.home.arpa'].some((s) => host.endsWith(s))
  ) {
    return 'That address is on a private network'
  }
  return undefined
}
