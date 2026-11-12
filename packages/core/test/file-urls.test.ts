import { describe, expect, it } from 'vitest'

import { FILE_URL_WINDOW_SECONDS, signFileUrl, verifyFileSignature } from '#src/node/index.ts'

const secret = 'a-long-instance-secret-for-tests-0123456789'
const sha = 'a'.repeat(64)
const check = (
  signed: { exp: number; sig: string },
  overrides: { sha256?: string; sig?: string; exp?: string } = {},
  now?: number,
  withSecret = secret,
) =>
  verifyFileSignature(
    withSecret,
    { sha256: sha, exp: String(signed.exp), sig: signed.sig, ...overrides },
    now === undefined ? {} : { now },
  )

describe('signFileUrl / verifyFileSignature', () => {
  it('accepts its own signature until the expiry', () => {
    const now = 1_700_000_000_000
    const signed = signFileUrl(secret, sha, { now })
    expect(check(signed, {}, now)).toBe(true)
    expect(check(signed, {}, signed.exp * 1000 - 1)).toBe(true)
    expect(check(signed, {}, signed.exp * 1000)).toBe(false)
  })

  it('is valid for at least one window, and the same all through a window', () => {
    const windowMs = FILE_URL_WINDOW_SECONDS * 1000
    const start = Math.floor(1_700_000_000_000 / windowMs) * windowMs
    const a = signFileUrl(secret, sha, { now: start })
    const b = signFileUrl(secret, sha, { now: start + windowMs - 1 })
    expect(a).toEqual(b)
    expect(a.exp * 1000 - (start + windowMs - 1)).toBeGreaterThanOrEqual(windowMs)
  })

  it('rejects another hash, secret, expiry or a mangled signature', () => {
    const now = 1_700_000_000_000
    const signed = signFileUrl(secret, sha, { now })
    expect(check(signed, { sha256: 'b'.repeat(64) }, now)).toBe(false)
    expect(check(signed, {}, now, 'another-secret-another-secret-0123456789')).toBe(false)
    expect(check(signed, { exp: String(signed.exp + 3600) }, now)).toBe(false)
    expect(check(signed, { sig: signed.sig.slice(1) }, now)).toBe(false)
    expect(check(signed, { sig: '' }, now)).toBe(false)
    expect(check(signed, { exp: 'soon' }, now)).toBe(false)
  })
})
