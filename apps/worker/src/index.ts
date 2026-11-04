import type { DbHandle } from '@zopheros/db'
import type { StorageDriver } from '@zopheros/storage'

export interface WorkerLogger {
  info(obj: object | string, msg?: string): void
  error(obj: object | string, msg?: string): void
}

export interface WorkerDeps {
  db: DbHandle
  storage: StorageDriver
  logger: WorkerLogger
}

export interface RunningWorker {
  stop(): Promise<void>
}

/**
 * Background job runner. M0 only wires up the process lifecycle; the pg-boss queue and the
 * diff/notify handlers arrive in M1 (PLAN §7.3).
 */
export async function startWorker(deps: WorkerDeps): Promise<RunningWorker> {
  await deps.db.ping()
  await deps.storage.healthCheck()
  deps.logger.info(
    { storage: deps.storage.kind },
    'worker started (no job handlers registered yet)',
  )
  return {
    async stop() {
      deps.logger.info('worker stopped')
    },
  }
}
