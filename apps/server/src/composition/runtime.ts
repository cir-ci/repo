import {
  type Auth,
  createAuth,
  createLiveMailer,
  MailNotConfiguredError,
  type Mailer,
} from '@circi/auth'
import { type Config, loadConfig } from '@circi/config'
import { createDb, type DbHandle } from '@circi/db'
import { createInstanceConfig, type InstanceConfigStore } from '@circi/services'
import { createStorage, type StorageDriver } from '@circi/storage'
import { type Logger, pino } from 'pino'

import { instanceEnvOf } from './instance-env.ts'
import { createSsoSync } from './sso-sync.ts'

export interface Runtime {
  config: Config
  logger: Logger
  db: DbHandle
  auth: Auth
  /** The instance's settings: the environment's over what the dashboard saved, read per request. */
  instanceConfig: InstanceConfigStore
  /** Sends mail through the current mail server settings; `configured()` says whether there are any. */
  mailer: Mailer
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
  const db = createDb({
    url: config.database.url,
    poolMax: config.database.poolMax,
    // A dropped connection is logged, not fatal: the pool reconnects (readyz reports the outage).
    onConnectionError: (err) => logger.warn({ err }, 'lost a database connection'),
  })
  const instanceConfig = createInstanceConfig({
    db: db.db,
    authSecret: config.authSecret,
    env: instanceEnvOf(config),
  })
  const mailer = createLiveMailer(async () => (await instanceConfig.get()).smtp)

  const syncSso = createSsoSync({
    instanceConfig,
    auth: () => auth,
    onError: (err) => logger.warn({ err }, 'could not set up the single sign-on providers'),
  })

  const auth = createAuth({
    db: db.db,
    secret: config.authSecret,
    baseURL: config.publicUrl.origin,
    mailer,
    passwordLogin: async () => (await instanceConfig.get()).signIn.password,
    refresh: syncSso,
    onMailError: (err) => {
      if (err instanceof MailNotConfiguredError) return
      logger.error({ err }, 'could not send a mail')
    },
  })
  const storage = createStorage(config.storage)
  return {
    config,
    logger,
    db,
    auth,
    instanceConfig,
    mailer,
    storage,
    async close() {
      await db.close()
    },
  }
}
