import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Signed, expiring links to content-addressed files (screenshots, diffs, thumbnails). Whoever
 * authorized a hash for a user (a read model that returned it) mints `exp` and `sig`; serving
 * the file then needs only the secret, no session and no access query. The signature covers the
 * hash and the expiry (`exp`, epoch seconds), under a key derived from the instance secret and
 * separate from every other key made from it.
 *
 * `exp` is the end of a fixed window rather than "now plus a while", so every link minted for a
 * hash in the same window is identical and a browser can keep its cached copy under one URL.
 */

/** How long a window is: a link is valid for between one and two windows. */
export const FILE_URL_WINDOW_SECONDS = 3600

const mac = (secret: string, sha256: string, exp: number) =>
  createHmac('sha256', `circi-file-url:${secret}`)
    .update(`${sha256}.${exp}`)
    .digest()
    .subarray(0, 16)

export function signFileUrl(
  secret: string,
  sha256: string,
  options: { now?: number } = {},
): { exp: number; sig: string } {
  const nowSeconds = Math.floor((options.now ?? Date.now()) / 1000)
  const exp = (Math.floor(nowSeconds / FILE_URL_WINDOW_SECONDS) + 2) * FILE_URL_WINDOW_SECONDS
  return { exp, sig: mac(secret, sha256, exp).toString('base64url') }
}

/** Whether `sig` is the signature of this hash and expiry, and `exp` has not passed. */
export function verifyFileSignature(
  secret: string,
  input: { sha256: string; exp: string; sig: string },
  options: { now?: number } = {},
): boolean {
  if (!/^\d{1,12}$/.test(input.exp)) return false
  const exp = Number(input.exp)
  if (Math.floor((options.now ?? Date.now()) / 1000) >= exp) return false
  const expected = mac(secret, input.sha256, exp)
  const actual = Buffer.from(input.sig, 'base64url')
  // One string per signature: base64url's last character has bits that decode to nothing, so
  // without this a link with its last character changed would still verify.
  if (actual.toString('base64url') !== input.sig) return false
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}
