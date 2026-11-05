import { type Auth, createAuth } from '@circi/auth'
import { type Config, loadConfig } from '@circi/config'
import { createDb, type DbHandle } from '@circi/db'
import { createStorage, type StorageDriver } from '@circi/storage'
import { type Logger, pino } from 'pino'

export interface Runtime {
  config: Config
  logger: Logger
  db: DbHandle
  auth: Auth
  storage: StorageDriver
  close(): Promise<void>
}

export function createLogger(config: Pick<Config, 'logLevel' | 'env'>): Logger {
  return pino({
    level: config.logLevel,
    base: { service: 'circi' },
    redact: { paths: ['req.headers.authorization', 'req.headers.cookie'], remove: true },
  })
}

export function createRuntime(env: Record<string, string | undefined> = process.env): Runtime {
  const config = loadConfig(env)
  const logger = createLogger(config)
  const db = createDb({ url: config.database.url, poolMax: config.database.poolMax })
  const auth = createAuth({
    db: db.db,
    secret: config.authSecret,
    baseURL: config.publicUrl.origin,
  })
  const storage = createStorage(config.storage)
  return {
    config,
    logger,
    db,
    auth,
    storage,
    async close() {
      await db.close()
    },
  }
}
