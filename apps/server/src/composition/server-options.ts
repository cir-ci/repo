import type { Auth, Mailer } from '@circi/auth'
import type { Config } from '@circi/config'
import type { Database, ListenFn } from '@circi/db'
import type { InstanceConfigStore } from '@circi/services'
import { siteOrigin } from '@circi/sites'
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
  db: { db: Database; ping(): Promise<void>; listen?: ListenFn }
  auth: Auth
  storage: StorageDriver
  /** Sends mail through the current settings; `configured()` says whether a mail server is set up. */
  mailer?: Mailer
  /** The instance settings, read per request (the environment's over what the dashboard saved). */
  instanceConfig?: InstanceConfigStore
  /** Keeps the live GitHub App in step with the database (absent when the environment sets the App). */
  githubSync?: githubAppSync.Sync
}

/** Turns the configuration into the HTTP server's options: which scopes exist and with what. */
export function serverOptionsFor(rt: ServerRuntime, webDist: string): buildServer.Options {
  const { config } = rt
  const settings = rt.instanceConfig
  const sites = config.staticSites
    ? sitesDeps(config.staticSites, config.publicUrl, settings)
    : undefined
  const integrations = integrationConfig(config)
  const sync = rt.githubSync
  const live: Pick<Deps.IntegrationsOption, 'refresh' | 'invalidate'> = {
    refresh: async () => {
      // Reading the settings also brings the Slack app in `integrations` up to date.
      await settings?.get()
      await sync?.refresh()
    },
    invalidate: () => {
      sync?.invalidate()
      settings?.invalidate()
    },
  }
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
    ...(sites ? { tlsAsk: { db: rt.db.db } } : {}),
    api: {
      ...base,
      githubApp: config.github !== undefined,
      githubAppNow: () => integrations.github !== undefined,
      ...(sites ? { sites } : {}),
    },
    dashboard: {
      ...base,
      ...(settings ? { instanceConfig: settings } : {}),
      webhookAllowPrivate: config.webhookAllowPrivate,
      githubApp: config.github !== undefined,
      ...(config.githubApiUrl ? { githubApiUrl: config.githubApiUrl } : {}),
      integrations: { config: integrations, ...live },
      ...(sites ? { sites } : {}),
      authSecret: config.authSecret,
      ...(config.vapid ? { vapid: config.vapid } : {}),
      instance: { config, ...(rt.mailer ? { mailer: rt.mailer } : {}) },
      ...(rt.db.listen
        ? { live: { listen: rt.db.listen, maxStreams: config.liveMaxStreams } }
        : {}),
      webDist,
    },
    checks: [
      { name: 'database', check: () => rt.db.ping() },
      { name: 'storage', check: () => rt.storage.healthCheck() },
    ],
  }
}

/** Where sites live: `<label>.<sites domain>` (or a custom domain) with the dashboard's scheme and port. */
function sitesDeps(
  sites: NonNullable<Config['staticSites']>,
  publicUrl: Config['publicUrl'],
  settings: InstanceConfigStore | undefined,
): Deps.Sites {
  return {
    host: sites.host,
    maxBytes: sites.maxBytes,
    ...(settings
      ? {
          maxBytesNow: async () => (await settings.get()).limits.staticSitesMaxMb * 1024 * 1024,
        }
      : {}),
    originFor: (label) => siteOrigin(publicUrl.origin, sites.host, label),
  }
}
