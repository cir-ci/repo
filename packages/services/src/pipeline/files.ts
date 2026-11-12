import { createHash } from 'node:crypto'
import type { Readable } from 'node:stream'

import { type Database } from '@circi/db'
import { getFile } from '@circi/db/queries'
import { upsertServerFile } from '@circi/db/repositories'
import { contentKey, type StorageDriver } from '@circi/storage'

/** Reading stored files, and storing the files the worker makes itself. */

export type Loader = (sha256: string) => Promise<Buffer>

/** A loader that frees a file's bytes after the last pair that needs them has finished. */
export interface RefCountedLoader {
  (sha256: string): Promise<Buffer>
  /** Marks one use of the file done; the bytes are dropped when no use is left. */
  release(sha256: string): void
  /** Files held right now. */
  size(): number
  /** The most files held at once. */
  peak(): number
}

/** Reads one file's bytes from storage, without keeping them. */
export function createFetcher(db: Database, storage: StorageDriver): Loader {
  return async (sha256) => {
    const file = await getFile(db, sha256)
    if (!file) throw new Error(`file ${sha256} missing from the database`)
    return readAll(await storage.get(file.storageKey))
  }
}

/**
 * Loads file bytes once while pairs share them, and frees them after their last use. `uses` says
 * how many `release` calls each file will get (one per pair that reads it); the cache then holds
 * only what the pairs in flight need, not the whole build. A file with no count is never freed.
 */
export function createLoader(
  db: Database,
  storage: StorageDriver,
  uses: ReadonlyMap<string, number> = new Map(),
): RefCountedLoader {
  const fetch = createFetcher(db, storage)
  const cache = new Map<string, Promise<Buffer>>()
  const left = new Map(uses)
  let peak = 0
  const load = (sha256: string): Promise<Buffer> => {
    let p = cache.get(sha256)
    if (!p) {
      p = fetch(sha256)
      cache.set(sha256, p)
      peak = Math.max(peak, cache.size)
      // A failed read is not kept: the next use tries again.
      p.catch(() => {
        if (cache.get(sha256) === p) cache.delete(sha256)
      })
    }
    return p
  }
  return Object.assign(load, {
    release: (sha256: string): void => {
      const counted = left.get(sha256)
      if (counted === undefined) return
      const n = counted - 1
      if (n > 0) left.set(sha256, n)
      else {
        left.delete(sha256)
        cache.delete(sha256)
      }
    },
    size: (): number => cache.size,
    peak: (): number => peak,
  })
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
