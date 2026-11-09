import type { Auth, Mailer } from '@circi/auth'
import type { Config } from '@circi/config'
import type { Database } from '@circi/db'
import type { StorageDriver } from '@circi/storage'
import type { Logger } from 'pino'

import type { githubAppSync } from '#composition/github-app.ts'
import type { buildServer } from '#http/app.ts'
import type { Deps } from '#http/lib/deps.ts'

import { integrationConfig } from './integration-config.ts'

/** What `serverOptionsFor` needs from the runtime. */
export interface ServerRuntime {
  config: Config
  logger: Logger
  db: { db: Database; ping(): Promise<void> }
  auth: Auth
  storage: StorageDriver
  /** Sends mail; absent without SMTP. */
  mailer?: Mailer
  /** Keeps the live GitHub App in step with the database (absent when the environment sets the App). */
  githubSync?: githubAppSync.Sync
}

/** Turns the configuration into the HTTP server's options: which scopes exist and with what. */
export function serverOptionsFor(rt: ServerRuntime, webDist: string): buildServer.Options {
  const { config } = rt
  const sites = config.staticSites ? sitesDeps(config.staticSites, config.publicUrl) : undefined
  const integrations = integrationConfig(config)
  const sync = rt.githubSync
  const live: Pick<Deps.IntegrationsOption, 'refresh' | 'invalidate'> = sync
    ? { refresh: async () => void (await sync.refresh()), invalidate: () => sync.invalidate() }
    : {}
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
    gitWebhook: {
      db: rt.db.db,
      authSecret: config.authSecret,
      publicOrigin: config.publicUrl.origin,
      integrations: { config: integrations, ...live },
      webhookAllowPrivate: config.webhookAllowPrivate,
      logger: rt.logger,
    },
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
      githubAppNow: () => integrations.github !== undefined,
      ...(sites ? { sites } : {}),
    },
    dashboard: {
      ...base,
      emailLogin: config.emailLogin,
      passwordLogin: config.passwordLogin,
      sso: config.sso.map((p) => ({ id: p.id, name: p.name })),
      webhookAllowPrivate: config.webhookAllowPrivate,
      workspaceCreation: config.workspaceCreation,
      githubApp: config.github !== undefined,
      ...(config.githubApiUrl ? { githubApiUrl: config.githubApiUrl } : {}),
      integrations: { config: integrations, ...live },
      ...(sites ? { sites } : {}),
      authSecret: config.authSecret,
      instance: { config, ...(rt.mailer ? { mailer: rt.mailer } : {}) },
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
): Deps.Sites {
  const port = new URL(publicUrl.origin).port
  return {
    host: sites.host,
    maxBytes: sites.maxBytes,
    originFor: (label) => `${publicUrl.protocol}//${label}.${sites.host}${port ? `:${port}` : ''}`,
  }
}
