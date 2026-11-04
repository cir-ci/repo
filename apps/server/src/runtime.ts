import { type Config, loadConfig } from '@zopheros/config'
import { createDb, type DbHandle } from '@zopheros/db'
import { createStorage, type StorageDriver } from '@zopheros/storage'
import { type Logger, pino } from 'pino'

export interface Runtime {
  config: Config
  logger: Logger
  db: DbHandle
  storage: StorageDriver
  close(): Promise<void>
}

export function createLogger(config: Pick<Config, 'logLevel' | 'env'>): Logger {
  return pino({
    level: config.logLevel,
    base: { service: 'zopheros' },
    redact: { paths: ['req.headers.authorization', 'req.headers.cookie'], remove: true },
  })
}

export function createRuntime(env: Record<string, string | undefined> = process.env): Runtime {
  const config = loadConfig(env)
  const logger = createLogger(config)
  const db = createDb({ url: config.database.url, poolMax: config.database.poolMax })
  const storage = createStorage(config.storage)
  return {
    config,
    logger,
    db,
    storage,
    async close() {
      await db.close()
    },
  }
}
