import type { Auth } from '@circi/auth'
import type { Config } from '@circi/config'
import type { Database } from '@circi/db'
import type { GithubApp } from '@circi/providers'
import type { StorageDriver } from '@circi/storage'
import type { Logger } from 'pino'

import type { ServerOptions } from './http/app.ts'

/** What `serverOptionsFor` needs from the runtime. */
export interface ServerRuntime {
  config: Config
  logger: Logger
  db: { db: Database; ping(): Promise<void> }
  auth: Auth
  storage: StorageDriver
  github?: GithubApp
}

/** Turns the configuration into the HTTP server's options: which scopes exist and with what. */
export function serverOptionsFor(rt: ServerRuntime, webDist: string): ServerOptions {
  const { config } = rt
  const base = {
    db: rt.db.db,
    auth: rt.auth,
    storage: rt.storage,
    publicOrigin: config.publicUrl.origin,
  }
  return {
    logger: rt.logger,
    publicOrigin: config.publicUrl.origin,
    previousHosts: config.previousPublicHosts,
    ...(config.github
      ? {
          githubWebhook: {
            db: rt.db.db,
            secret: config.github.webhookSecret,
            github: rt.github,
            publicOrigin: config.publicUrl.origin,
            logger: rt.logger,
          },
        }
      : {}),
    api: { ...base, githubApp: config.github !== undefined },
    dashboard: {
      ...base,
      emailLogin: config.emailLogin,
      passwordLogin: config.passwordLogin,
      sso: config.sso.map((p) => ({ id: p.id, name: p.name })),
      webhookAllowPrivate: config.webhookAllowPrivate,
      orgCreation: config.orgCreation,
      githubApp: config.github !== undefined,
      authSecret: config.authSecret,
      webDist,
    },
    checks: [
      { name: 'database', check: () => rt.db.ping() },
      { name: 'storage', check: () => rt.storage.healthCheck() },
    ],
  }
}
