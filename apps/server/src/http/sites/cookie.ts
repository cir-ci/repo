import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * A hosted site's own cookie (PLAN §7.6): `<session id>.<signature>`, valid for one address only
 * (the signature covers the address), host-only (`__Host-` prefix over https: no Domain,
 * Path=/, Secure), HttpOnly. It stands for a row in `site_sessions`, which is what gets revoked.
 */

export const COOKIE_TTL_SECONDS = 3600

export function cookieName(secure: boolean): string {
  return secure ? '__Host-circi_site' : 'circi_site'
}

const sign = (secret: string, id: string, label: string) =>
  createHmac('sha256', `circi-site-cookie:${secret}`).update(`${id}\0${label}`).digest('base64url')

export function makeCookieValue(secret: string, id: string, label: string): string {
  return `${id}.${sign(secret, id, label)}`
}

/** The session id in a cookie value, if the signature is right for this address. */
export function readCookieValue(secret: string, value: string, label: string): string | undefined {
  const dot = value.lastIndexOf('.')
  if (dot <= 0) return undefined
  const id = value.slice(0, dot)
  const given = Buffer.from(value.slice(dot + 1))
  const expected = Buffer.from(sign(secret, id, label))
  return given.length === expected.length && timingSafeEqual(given, expected) ? id : undefined
}

export function parseCookies(header: string | undefined): Map<string, string> {
  const out = new Map<string, string>()
  for (const part of (header ?? '').split(';')) {
    const eq = part.indexOf('=')
    if (eq <= 0) continue
    const name = part.slice(0, eq).trim()
    if (name && !out.has(name)) out.set(name, part.slice(eq + 1).trim())
  }
  return out
}

export function setCookie(name: string, value: string, secure: boolean): string {
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${COOKIE_TTL_SECONDS}${secure ? '; Secure' : ''}`
}

/**
 * `Set-Cookie` headers that expire every cookie on the request other than `keep`. Uploaded code
 * can stuff the cookie jar of the sites domain until requests are refused as too large; this
 * clears it on the next request instead of locking the person out of every site. Each cookie is
 * expired both as host-only and as a domain cookie of `sitesHost`.
 */
export function cleanupCookies(
  header: string | undefined,
  keep: string,
  sitesHost: string,
  secure: boolean,
): string[] {
  const out: string[] = []
  const flags = `Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT${secure ? '; Secure' : ''}`
  for (const name of parseCookies(header).keys()) {
    if (name === keep || !/^[\w.!#$%&'*+^`|~-]+$/.test(name)) continue
    out.push(`${name}=; Path=/; ${flags}`)
    out.push(`${name}=; Path=/; Domain=${sitesHost}; ${flags}`)
  }
  return out
}
