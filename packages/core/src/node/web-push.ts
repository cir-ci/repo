import {
  createCipheriv,
  createECDH,
  createPrivateKey,
  createSign,
  type ECDH,
  hkdfSync,
  randomBytes,
} from 'node:crypto'

/**
 * Web push without a library: VAPID (RFC 8292) to say who is pushing, and the `aes128gcm`
 * encrypted payload (RFC 8291) so the browser vendor's push service only carries ciphertext.
 * Pure computation: sending the request is the caller's job.
 */

export interface VapidKeys {
  /** The uncompressed P-256 point, base64url (what `applicationServerKey` takes in the browser). */
  publicKey: string
  /** The raw private scalar, base64url. Never leaves the server. */
  privateKey: string
}

const b64 = (buf: Buffer | Uint8Array) => Buffer.from(buf).toString('base64url')

export function generateVapidKeys(): VapidKeys {
  const ecdh = createECDH('prime256v1')
  ecdh.generateKeys()
  return { publicKey: b64(ecdh.getPublicKey()), privateKey: b64(ecdh.getPrivateKey()) }
}

/** Whether a key pair is usable: a 65-byte public point and a 32-byte private scalar that belong together. */
export function isValidVapidKeys(keys: VapidKeys): boolean {
  try {
    const ecdh = createECDH('prime256v1')
    const priv = Buffer.from(keys.privateKey, 'base64url')
    ecdh.setPrivateKey(priv)
    return (
      priv.length === 32 && ecdh.getPublicKey().equals(Buffer.from(keys.publicKey, 'base64url'))
    )
  } catch {
    return false
  }
}

/** The `Authorization` header that identifies this server to the push service of `endpoint`. */
export function vapidAuthorization(input: {
  endpoint: string
  keys: VapidKeys
  /** A `mailto:` or `https:` contact for the push service operator. */
  subject: string
  now?: Date
}): string {
  const { endpoint, keys, subject } = input
  const exp = Math.floor((input.now ?? new Date()).getTime() / 1000) + 12 * 60 * 60
  const header = b64(Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'ES256' })))
  const claims = b64(
    Buffer.from(JSON.stringify({ aud: new URL(endpoint).origin, exp, sub: subject })),
  )
  const publicBytes = Buffer.from(keys.publicKey, 'base64url')
  const key = createPrivateKey({
    key: {
      kty: 'EC',
      crv: 'P-256',
      x: b64(publicBytes.subarray(1, 33)),
      y: b64(publicBytes.subarray(33, 65)),
      d: keys.privateKey,
    },
    format: 'jwk',
  })
  const signature = createSign('SHA256')
    .update(`${header}.${claims}`)
    .sign({ key, dsaEncoding: 'ieee-p1363' })
  return `vapid t=${header}.${claims}.${b64(signature)}, k=${keys.publicKey}`
}

export interface PushRecipient {
  /** The browser's `p256dh` key, base64url. */
  p256dh: string
  /** The browser's 16-byte `auth` secret, base64url. */
  auth: string
}

/**
 * Encrypts `payload` for one subscription as a single `aes128gcm` record. `ephemeral` and `salt`
 * are for tests; a real send makes fresh ones.
 */
export function encryptPushPayload(
  recipient: PushRecipient,
  payload: Uint8Array,
  options: { ephemeral?: ECDH; salt?: Buffer } = {},
): Buffer {
  const uaPublic = Buffer.from(recipient.p256dh, 'base64url')
  const authSecret = Buffer.from(recipient.auth, 'base64url')
  if (uaPublic.length !== 65 || uaPublic[0] !== 4) throw new Error('invalid p256dh key')
  if (authSecret.length !== 16) throw new Error('invalid auth secret')
  if (payload.length > 3993) throw new Error('payload too large for one push record')
  const as = options.ephemeral ?? createECDH('prime256v1')
  if (!options.ephemeral) as.generateKeys()
  const asPublic = as.getPublicKey()
  const salt = options.salt ?? randomBytes(16)
  const shared = as.computeSecret(uaPublic)
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic])
  const ikm = Buffer.from(hkdfSync('sha256', shared, authSecret, keyInfo, 32))
  const cek = Buffer.from(
    hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16),
  )
  const nonce = Buffer.from(
    hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12),
  )
  const cipher = createCipheriv('aes-128-gcm', cek, nonce)
  // One record: the data, then 0x02 marking it as the last.
  const body = Buffer.concat([
    cipher.update(Buffer.concat([Buffer.from(payload), Buffer.from([2])])),
    cipher.final(),
    cipher.getAuthTag(),
  ])
  const header = Buffer.alloc(16 + 4 + 1)
  salt.copy(header, 0)
  header.writeUInt32BE(4096, 16)
  header.writeUInt8(asPublic.length, 20)
  return Buffer.concat([header, asPublic, body])
}
