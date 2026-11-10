import { createDecipheriv, createECDH, createVerify, hkdfSync, randomBytes } from 'node:crypto'

import {
  encryptPushPayload,
  generateVapidKeys,
  isValidVapidKeys,
  vapidAuthorization,
} from '@circi/core/node'
import { describe, expect, it } from 'vitest'

/** The browser's side of RFC 8291, written from the RFC separately from the encryption. */
function decrypt(body: Buffer, uaKeys: ReturnType<typeof createECDH>, authSecret: Buffer) {
  const salt = body.subarray(0, 16)
  const idlen = body[20] ?? 0
  const asPublic = body.subarray(21, 21 + idlen)
  const record = body.subarray(21 + idlen)
  const shared = uaKeys.computeSecret(asPublic)
  const info = Buffer.concat([Buffer.from('WebPush: info\0'), uaKeys.getPublicKey(), asPublic])
  const prk = Buffer.from(hkdfSync('sha256', shared, authSecret, info, 32))
  const cek = Buffer.from(hkdfSync('sha256', prk, salt, 'Content-Encoding: aes128gcm\0', 16))
  const nonce = Buffer.from(hkdfSync('sha256', prk, salt, 'Content-Encoding: nonce\0', 12))
  const decipher = createDecipheriv('aes-128-gcm', cek, nonce)
  decipher.setAuthTag(record.subarray(record.length - 16))
  const plain = Buffer.concat([
    decipher.update(record.subarray(0, record.length - 16)),
    decipher.final(),
  ])
  return plain.subarray(0, plain.lastIndexOf(2))
}

describe('web push crypto', () => {
  it('makes a VAPID key pair that checks out, and rejects a mismatched one', () => {
    const a = generateVapidKeys()
    expect(Buffer.from(a.publicKey, 'base64url')).toHaveLength(65)
    expect(isValidVapidKeys(a)).toBe(true)
    const other = generateVapidKeys()
    expect(isValidVapidKeys({ publicKey: other.publicKey, privateKey: a.privateKey })).toBe(false)
    expect(isValidVapidKeys({ publicKey: 'x', privateKey: 'y' })).toBe(false)
  })

  it('signs a VAPID token for the endpoint origin that the public key verifies', () => {
    const keys = generateVapidKeys()
    const now = new Date('2026-11-10T10:00:00Z')
    const header = vapidAuthorization({
      endpoint: 'https://push.example.com/send/abc',
      keys,
      subject: 'mailto:ops@example.com',
      now,
    })
    const m = /^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=([\w-]+)$/.exec(header)
    expect(m).not.toBeNull()
    const [, h, c, s, k] = m ?? []
    expect(k).toBe(keys.publicKey)
    const claims: unknown = JSON.parse(Buffer.from(c ?? '', 'base64url').toString())
    expect(claims).toEqual({
      aud: 'https://push.example.com',
      exp: Math.floor(now.getTime() / 1000) + 43200,
      sub: 'mailto:ops@example.com',
    })
    const pub = Buffer.from(keys.publicKey, 'base64url')
    const verified = createVerify('SHA256')
      .update(`${h}.${c}`)
      .verify(
        {
          key: {
            kty: 'EC',
            crv: 'P-256',
            x: pub.subarray(1, 33).toString('base64url'),
            y: pub.subarray(33).toString('base64url'),
          },
          format: 'jwk',
          dsaEncoding: 'ieee-p1363',
        },
        Buffer.from(s ?? '', 'base64url'),
      )
    expect(verified).toBe(true)
  })

  it('encrypts a payload the subscription can decrypt (RFC 8291 round trip)', () => {
    const ua = createECDH('prime256v1')
    ua.generateKeys()
    const auth = randomBytes(16)
    const text = JSON.stringify({ title: 'Review requested', body: 'Dana asked you', url: '/x' })
    const body = encryptPushPayload(
      { p256dh: ua.getPublicKey().toString('base64url'), auth: auth.toString('base64url') },
      Buffer.from(text),
    )
    expect(body.readUInt32BE(16)).toBe(4096)
    expect(body[20]).toBe(65)
    expect(decrypt(body, ua, auth).toString()).toBe(text)
  })

  it('refuses a malformed key or a payload too large for one record', () => {
    const ua = createECDH('prime256v1')
    ua.generateKeys()
    const ok = {
      p256dh: ua.getPublicKey().toString('base64url'),
      auth: randomBytes(16).toString('base64url'),
    }
    expect(() => encryptPushPayload({ ...ok, p256dh: 'abc' }, Buffer.from('x'))).toThrow('p256dh')
    expect(() => encryptPushPayload({ ...ok, auth: 'abc' }, Buffer.from('x'))).toThrow('auth')
    expect(() => encryptPushPayload(ok, Buffer.alloc(4000))).toThrow('too large')
  })
})
