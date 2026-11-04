import { createHash } from 'node:crypto'
import type { Readable } from 'node:stream'

import { type Database, getFile, upsertServerFile } from '@circi/db'
import { contentKey, type StorageDriver } from '@circi/storage'

/** Reading stored files, and storing the files the worker makes itself. */

export type Loader = (sha256: string) => Promise<Buffer>

/** Loads file bytes once per build, even when several pairs share a file. */
export function createLoader(db: Database, storage: StorageDriver): Loader {
  const cache = new Map<string, Promise<Buffer>>()
  return (sha256) => {
    let p = cache.get(sha256)
    if (!p) {
      p = (async () => {
        const file = await getFile(db, sha256)
        if (!file) throw new Error(`file ${sha256} missing from the database`)
        return readAll(await storage.get(file.storageKey))
      })()
      cache.set(sha256, p)
    }
    return p
  }
}

/** Stores bytes the server made itself (diffs, thumbnails), deduplicated by hash. */
export async function storeServerFile(
  db: Database,
  storage: StorageDriver,
  bytes: Buffer,
  meta: { kind: 'diff' | 'thumbnail'; contentType: string; width: number; height: number },
): Promise<string> {
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  const existing = await getFile(db, sha256)
  if (existing?.status === 'verified') return sha256
  const key = existing?.storageKey ?? contentKey(sha256)
  await storage.put(key, bytes, { expectedSha256: sha256, contentType: meta.contentType })
  await upsertServerFile(db, {
    sha256,
    storageKey: key,
    kind: meta.kind,
    size: bytes.length,
    contentType: meta.contentType,
    width: meta.width,
    height: meta.height,
  })
  return sha256
}

export async function readAll(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  return Buffer.concat(chunks)
}
