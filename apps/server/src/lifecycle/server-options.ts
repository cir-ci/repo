import type { Auth } from '@circi/auth'
import type { Config } from '@circi/config'
import type { Database } from '@circi/db'
import type { GithubApp, ProviderRegistry } from '@circi/providers'
import type { StorageDriver } from '@circi/storage'
import type { Logger } from 'pino'

import type { ServerOptions } from '#http/app.ts'
import type { SitesDeps } from '#http/lib/deps.ts'

/** What `serverOptionsFor` needs from the runtime. */
export interface ServerRuntime {
  config: Config
  logger: Logger
  db: { db: Database; ping(): Promise<void> }
  auth: Auth
  storage: StorageDriver
  github?: GithubApp
  providers?: ProviderRegistry
}

/** Turns the configuration into the HTTP server's options: which scopes exist and with what. */
export function serverOptionsFor(rt: ServerRuntime, webDist: string): ServerOptions {
  const { config } = rt
  const sites = config.staticSites ? sitesDeps(config.staticSites, config.publicUrl) : undefined
  const base = {
    db: rt.db.db,
    auth: rt.auth,
    storage: rt.storage,
    publicOrigin: config.publicUrl.origin,
  }
  return {
    logger: rt.logger,
    trustedProxies: config.trustedProxies,
    publicOrigin: config.publicUrl.origin,
    previousHosts: config.previousPublicHosts,
    ...(config.github
      ? {
          githubWebhook: {
            db: rt.db.db,
            secret: config.github.webhookSecret,
            github: rt.github,
            ...(rt.providers ? { providers: rt.providers } : {}),
            publicOrigin: config.publicUrl.origin,
            logger: rt.logger,
          },
        }
      : {}),
    ...(sites
      ? {
          siteServing: {
            db: rt.db.db,
            storage: rt.storage,
            publicOrigin: config.publicUrl.origin,
            sites,
            secret: config.authSecret,
          },
        }
      : {}),
    api: {
      ...base,
      githubApp: config.github !== undefined,
      ...(sites ? { sites } : {}),
    },
    dashboard: {
      ...base,
      emailLogin: config.emailLogin,
      passwordLogin: config.passwordLogin,
      sso: config.sso.map((p) => ({ id: p.id, name: p.name })),
      webhookAllowPrivate: config.webhookAllowPrivate,
      orgCreation: config.orgCreation,
      githubApp: config.github !== undefined,
      ...(rt.providers ? { providers: rt.providers } : {}),
      ...(sites ? { sites } : {}),
      authSecret: config.authSecret,
      webDist,
    },
    checks: [
      { name: 'database', check: () => rt.db.ping() },
      { name: 'storage', check: () => rt.storage.healthCheck() },
    ],
  }
}

/** Where sites live: `<label>.<sites domain>` with the dashboard's scheme and port. */
function sitesDeps(
  sites: NonNullable<Config['staticSites']>,
  publicUrl: Config['publicUrl'],
): SitesDeps {
  const port = new URL(publicUrl.origin).port
  return {
    host: sites.host,
    maxBytes: sites.maxBytes,
    originFor: (label) => `${publicUrl.protocol}//${label}.${sites.host}${port ? `:${port}` : ''}`,
  }
}
