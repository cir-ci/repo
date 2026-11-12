import { type Database, tryAdvisoryLock } from '@circi/db'
import { deleteFinishedJobs } from '@circi/db/queue'

/**
 * Runs a periodic sweep on one process at a time: `fn` runs inside a Postgres try-lock named
 * `sweep:<name>`, and resolves to `{ ran: false }` at once when another process already holds it
 * (a busy sweep is skipped, never queued). `fn` receives the lock's transaction as its database.
 */
export async function runExclusive<T>(
  db: Database,
  name: string,
  fn: (db: Database) => Promise<T>,
): Promise<{ ran: true; value: T } | { ran: false }> {
  return tryAdvisoryLock(db, `sweep:${name}`, fn)
}

/**
 * Deletes done and failed jobs that finished more than `olderThanDays` ago, `batchSize` rows at a
 * time so no statement runs long. Resolves to how many went. Pending and running jobs stay.
 */
export async function pruneFinishedJobs(
  db: Database,
  options: { olderThanDays: number; batchSize?: number; now?: Date },
): Promise<number> {
  const batch = options.batchSize ?? 1000
  const before = new Date(
    (options.now ?? new Date()).getTime() - options.olderThanDays * 86_400_000,
  )
  let total = 0
  for (;;) {
    // oxlint-disable-next-line no-await-in-loop -- batches run one after another
    const n = await deleteFinishedJobs(db, before, batch)
    total += n
    if (n < batch) return total
  }
}
