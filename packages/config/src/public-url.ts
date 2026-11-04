export interface PublicAddress {
  /** Normalized origin without a trailing slash, e.g. `https://ci.acme.io` or `http://localhost:3000`. */
  origin: string
  /** Lowercased `host[:port]` as browsers send it in the Host header (default ports omitted). */
  host: string
  protocol: 'http:' | 'https:'
  hostname: string
}

const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]'])

/**
 * Parses a dashboard address. Any host and port works; it must be the root of that host,
 * because dashboard cookies use the `__Host-` prefix (which requires `Path=/`) and the site
 * sign-in handoff redirects to fixed paths on it. Returns an error message instead of throwing.
 */
export function parsePublicAddress(raw: string, name: string): PublicAddress | string {
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    return `${name}: "${raw}" is not a URL (expected e.g. https://ci.example.com)`
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return `${name}: must start with https:// or http:// (got ${url.protocol})`
  }
  if (url.username || url.password) return `${name}: must not contain a username or password`
  if (url.search || url.hash) return `${name}: must not contain a query string or #fragment`
  if (url.pathname !== '/' && url.pathname !== '') {
    return `${name}: must be the root of a host, without a path (got "${url.pathname}"). CirCI needs its own hostname, such as a subdomain; it can't share a host under a sub-path.`
  }
  return {
    origin: url.origin,
    host: url.host.toLowerCase(),
    protocol: url.protocol,
    hostname: url.hostname.toLowerCase(),
  }
}

export function isLocalAddress(address: PublicAddress): boolean {
  return LOCAL_HOSTNAMES.has(address.hostname) || address.hostname.endsWith('.localhost')
}
