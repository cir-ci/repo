import { randomUUID } from 'node:crypto'
import { InvalidKeyError } from './types.ts'

const KEY_RE = /^[A-Za-z0-9][A-Za-z0-9._\-/]*$/
const SHA256_HEX_RE = /^[0-9a-f]{64}$/

/** Keys are relative, slash-separated, and can never escape the storage root. */
export function assertValidKey(key: string): void {
  if (key.length === 0 || key.length > 1024) throw new InvalidKeyError(key, 'length must be 1–1024')
  if (!KEY_RE.test(key)) throw new InvalidKeyError(key, 'only [A-Za-z0-9._-/] allowed')
  for (const segment of key.split('/')) {
    if (segment === '' || segment === '.' || segment === '..') {
      throw new InvalidKeyError(key, 'empty, "." and ".." segments are not allowed')
    }
  }
  if (key.startsWith('.tmp/')) throw new InvalidKeyError(key, '".tmp/" is reserved')
}

export function assertSha256Hex(value: string): void {
  if (!SHA256_HEX_RE.test(value)) throw new Error(`Not a lowercase hex sha256: "${value}"`)
}

/**
 * Content-addressed key with a generation suffix (PLAN §6 `files.storage_key`).
 * `ab/cd/<sha256>/<uuid>`: the two-level fan-out keeps FS directories small, and the
 * generation means deleting an old object can never remove a newer upload of the same hash.
 */
export function contentKey(sha256: string, generation: string = randomUUID()): string {
  assertSha256Hex(sha256)
  return `${sha256.slice(0, 2)}/${sha256.slice(2, 4)}/${sha256}/${generation}`
}

export function hexToBase64(hex: string): string {
  return Buffer.from(hex, 'hex').toString('base64')
}

export function base64ToHex(b64: string): string {
  return Buffer.from(b64, 'base64').toString('hex')
}
