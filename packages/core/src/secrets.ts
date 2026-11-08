import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto'

/**
 * Seals a credential (an access token, a bot token) for storage in a text column: AES-256-GCM
 * under a key derived from the instance secret (`BETTER_AUTH_SECRET`). The result is
 * `v1.<iv>.<tag>.<ciphertext>` in base64url. Rotating the instance secret makes stored
 * credentials unreadable, as it does for sessions: connections then need to be set up again.
 */

const key = (secret: string) =>
  Buffer.from(hkdfSync('sha256', secret, 'circi', 'integration-credentials', 32))

export function sealSecret(secret: string, plaintext: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key(secret), iv)
  const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  return ['v1', iv, cipher.getAuthTag(), body]
    .map((p) => (typeof p === 'string' ? p : p.toString('base64url')))
    .join('.')
}

/** The plaintext, or undefined when the value is malformed, tampered with or sealed under another secret. */
export function openSecret(secret: string, sealed: string): string | undefined {
  const [version, iv, tag, body] = sealed.split('.')
  if (version !== 'v1' || !iv || !tag || body === undefined) return undefined
  try {
    const decipher = createDecipheriv('aes-256-gcm', key(secret), Buffer.from(iv, 'base64url'))
    decipher.setAuthTag(Buffer.from(tag, 'base64url'))
    return Buffer.concat([
      decipher.update(Buffer.from(body, 'base64url')),
      decipher.final(),
    ]).toString('utf8')
  } catch {
    return undefined
  }
}
