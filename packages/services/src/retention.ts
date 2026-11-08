import {
  collectMarkedFiles,
  type Database,
  expireBuilds,
  expireSites,
  markUnreferencedFiles,
  previewCollection,
  unmarkReferencedFiles,
} from '@circi/db'

/**
 * One pass of retention (PLAN §8): expire old builds and sites, un-mark files that became
 * referenced, mark the ones nothing points at, and collect those marked longer than the grace
 * period. Safe to run often and from several processes: each step is idempotent and the
 * collection re-checks every file under a lock before deleting it.
 */
export async function runRetention(
  db: Database,
  options: {
    now?: Date
    /** How long a file stays marked before it's collected. Default 24 hours. */
    graceMs?: number
    deleteObject: (storageKey: string) => Promise<void>
  },
): Promise<runRetention.Result> {
  const now = options.now ?? new Date()
  const builds = await expireBuilds(db, now)
  const sites = await expireSites(db, now)
  const unmarked = await unmarkReferencedFiles(db)
  const marked = await markUnreferencedFiles(db, now)
  const collected = await collectMarkedFiles(db, {
    now,
    graceMs: options.graceMs ?? 24 * 3600_000,
    deleteObject: options.deleteObject,
  })
  return { expiredBuilds: builds, expiredSites: sites, unmarked, marked, ...collected }
}
export namespace runRetention {
  export interface Result {
    expiredBuilds: number
    expiredSites: { addresses: number; versions: number }
    unmarked: number
    marked: number
    deleted: number
    kept: number
  }
}

/**
 * `runRetention`'s file collection without doing it: what would be deleted (count, bytes, a
 * sample of storage keys) and how many files would be newly marked. Changes nothing.
 */
export async function previewRetention(
  db: Database,
  options: { now?: Date; graceMs?: number; sample?: number } = {},
): Promise<previewRetention.Result> {
  return previewCollection(db, {
    now: options.now ?? new Date(),
    graceMs: options.graceMs ?? 24 * 3600_000,
    ...(options.sample === undefined ? {} : { sample: options.sample }),
  })
}
export namespace previewRetention {
  export type Result = previewCollection.Preview
}
