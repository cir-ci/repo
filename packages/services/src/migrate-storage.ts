import { type Database, listVerifiedFiles } from '@circi/db'
import type { StorageDriver } from '@circi/storage'

/**
 * Copies every stored file from one storage driver to another, under the same keys (so the
 * database needs no change), then the operator points `STORAGE_DRIVER` at the new one. Each
 * copy is checked against the file's hash as it's written. Safe to run again: files the target
 * already has with the right size are skipped, so an interrupted run resumes.
 */
export async function migrateStorage(
  db: Database,
  input: {
    from: StorageDriver
    to: StorageDriver
    /** Called after each file, for progress. */
    onFile?: (done: number, sha256: string) => void
    /** How many files to read from the database at a time. Default 200. */
    batch?: number
  },
): Promise<migrateStorage.Result> {
  const result: migrateStorage.Result = { copied: 0, skipped: 0, missing: [], failed: [] }
  let after = ''
  let done = 0
  for (;;) {
    // eslint-disable-next-line no-await-in-loop -- pages are walked in order
    const page = await listVerifiedFiles(db, after, input.batch ?? 200)
    if (page.length === 0) break
    for (const file of page) {
      after = file.sha256
      done += 1
      try {
        // eslint-disable-next-line no-await-in-loop -- one object at a time keeps memory flat
        const existing = await input.to.head(file.storageKey)
        // A target that records the checksum (S3) is compared by hash, so a same-size corrupt
        // object is copied again; otherwise the size has to match.
        const intact =
          existing !== null &&
          (file.size === null || existing.size === file.size) &&
          (existing.sha256 === undefined || existing.sha256 === file.sha256)
        if (intact) {
          result.skipped += 1
        } else {
          // eslint-disable-next-line no-await-in-loop
          const source = await input.from.get(file.storageKey).catch(() => undefined)
          if (!source) {
            result.missing.push(file.sha256)
          } else {
            // eslint-disable-next-line no-await-in-loop
            await input.to.put(file.storageKey, source, {
              expectedSha256: file.sha256,
              ...(file.contentType ? { contentType: file.contentType } : {}),
            })
            result.copied += 1
          }
        }
      } catch (err) {
        result.failed.push({
          sha256: file.sha256,
          error: err instanceof Error ? err.message : String(err),
        })
      }
      input.onFile?.(done, file.sha256)
    }
  }
  return result
}
export namespace migrateStorage {
  export interface Result {
    copied: number
    skipped: number
    /** In the database as stored, but the source no longer has the object. */
    missing: string[]
    /** Could not be copied (the copy didn't match its hash, the target refused…). */
    failed: { sha256: string; error: string }[]
  }
}
