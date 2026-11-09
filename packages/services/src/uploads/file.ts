import type { Readable } from 'node:stream'

import { type Database, getFile, hasUploadClaim, markFileVerified } from '@circi/db'
import type { StorageDriver } from '@circi/storage'

/**
 * Whether a file may be uploaded now. Unknown: no build asked for it (with `buildId`: that build
 * did not). Verified: the store already has it. Pending: send the bytes, to `storageKey`.
 */
export async function findUpload(
  db: Database,
  input: { sha256: string; buildId?: string },
): Promise<findUpload.Result> {
  const file = await getFile(db, input.sha256)
  if (!file) return { state: 'unknown' }
  if (input.buildId !== undefined && !(await hasUploadClaim(db, input.buildId, input.sha256))) {
    return { state: 'unknown' }
  }
  if (file.status === 'verified') return { state: 'verified' }
  return { state: 'pending', storageKey: file.storageKey, contentType: file.contentType }
}

export namespace findUpload {
  export type Result =
    | { state: 'unknown' }
    | { state: 'verified' }
    | { state: 'pending'; storageKey: string; contentType: string | null }
}

/**
 * Stores a pending file's bytes and marks it verified. The storage driver writes the bytes only
 * if they hash to `sha256` (it throws `ChecksumMismatchError` otherwise); `accept` runs after
 * the bytes are stored and can refuse the file (for example a body cut off at the size limit),
 * which leaves it pending.
 */
export async function storeUpload(
  db: Database,
  storage: StorageDriver,
  input: storeUpload.Input,
): Promise<storeUpload.Result> {
  const result = await storage.put(input.storageKey, input.content, {
    expectedSha256: input.sha256,
    contentType: input.contentType ?? 'image/png',
  })
  if (input.accept && !input.accept()) return { status: 'rejected' }
  await db.transaction((tx) => markFileVerified(tx, input.sha256, { size: result.size }))
  return { status: 'verified', size: result.size }
}

export namespace storeUpload {
  export interface Input {
    sha256: string
    storageKey: string
    contentType: string | null
    content: Readable
    accept?: () => boolean
  }

  export type Result = { status: 'verified'; size: number } | { status: 'rejected' }
}
