import { openSecret, sealSecret } from '@circi/core'
import { type Database, getSetting, setSetting } from '@circi/db'
import type { IntegrationDefinition } from '@circi/integrations'
import { type GithubAppCredentials, GithubApp } from '@circi/providers'

import type { Deps } from './deps.ts'

/**
 * The instance's GitHub App when it was created with the one-click (manifest) flow: its
 * credentials live in `instance_settings` (`github_app`), the private key, webhook secret and
 * client secret sealed with the instance secret. `GITHUB_APP_*` in the environment always wins:
 * nothing here runs when it is set.
 *
 * The running server reads the App from `Deps.IntegrationsOption.config.github`, one live object
 * shared by the HTTP routes, the webhook and the worker; `useStoredGithubApp` fills it at start
 * and after the App is created, so no restart is needed.
 */

const KEY = 'github_app'

interface Stored {
  appId: string
  slug: string
  clientId: string
  htmlUrl: string
  apiUrl: string
  /** JSON `{ privateKey, webhookSecret, clientSecret }`, sealed. */
  sealed: string
}

export interface StoredGithubApp extends GithubAppCredentials {
  apiUrl: string
}

export async function storeGithubApp(
  db: Database,
  authSecret: string,
  app: StoredGithubApp,
): Promise<void> {
  const stored: Stored = {
    appId: app.appId,
    slug: app.slug,
    clientId: app.clientId,
    htmlUrl: app.htmlUrl,
    apiUrl: app.apiUrl,
    sealed: sealSecret(
      authSecret,
      JSON.stringify({
        privateKey: app.privateKey,
        webhookSecret: app.webhookSecret,
        clientSecret: app.clientSecret,
      }),
    ),
  }
  await setSetting(db, KEY, JSON.stringify(stored))
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

const field = (o: Record<string, unknown>, key: string): string | undefined => {
  const v = o[key]
  return typeof v === 'string' && v !== '' ? v : undefined
}

/** The stored App with its secrets opened; undefined when none is stored or it cannot be read. */
export async function readStoredGithubApp(
  db: Database,
  authSecret: string,
): Promise<StoredGithubApp | undefined> {
  const raw = await getSetting(db, KEY)
  if (!raw) return undefined
  try {
    const stored: unknown = JSON.parse(raw)
    if (!isRecord(stored)) return undefined
    const opened = openSecret(authSecret, field(stored, 'sealed') ?? '')
    const secrets: unknown = opened ? JSON.parse(opened) : undefined
    if (!isRecord(secrets)) return undefined
    const app = {
      appId: field(stored, 'appId'),
      slug: field(stored, 'slug'),
      clientId: field(stored, 'clientId'),
      htmlUrl: field(stored, 'htmlUrl'),
      apiUrl: field(stored, 'apiUrl'),
      privateKey: field(secrets, 'privateKey'),
      webhookSecret: field(secrets, 'webhookSecret'),
      clientSecret: field(secrets, 'clientSecret'),
    }
    const { appId, slug, clientId, htmlUrl, apiUrl, privateKey, webhookSecret, clientSecret } = app
    if (
      !(
        appId &&
        slug &&
        clientId &&
        htmlUrl &&
        apiUrl &&
        privateKey &&
        webhookSecret &&
        clientSecret
      )
    ) {
      return undefined
    }
    return { appId, slug, clientId, htmlUrl, apiUrl, privateKey, webhookSecret, clientSecret }
  } catch {
    return undefined
  }
}

/** Points the live configuration at the stored App (when there is one); true if it did. */
export async function useStoredGithubApp(
  db: Database,
  authSecret: string,
  config: IntegrationDefinition.InstanceConfig,
): Promise<boolean> {
  const app = await readStoredGithubApp(db, authSecret)
  if (!app) return false
  config.github = {
    apiUrl: app.apiUrl,
    appId: app.appId,
    privateKey: app.privateKey,
    webhookSecret: app.webhookSecret,
  }
  return true
}

/** How long a replica trusts what it last read of the stored App before it reads again. */
export const GITHUB_APP_TTL_MS = 30_000

export namespace githubAppSync {
  export interface Options {
    db: Database
    authSecret: string
    /** The live configuration shared by the routes, the webhook and the worker of this replica. */
    config: IntegrationDefinition.InstanceConfig
    /** Default 30 seconds. */
    ttlMs?: number
    /** Replaceable in tests. */
    now?: () => number
  }
  export interface Sync {
    /** Reads the stored App unless it was read less than the TTL ago; true when `config` changed. */
    refresh(): Promise<boolean>
    /** Forgets the last read, so the next `refresh` reads: call it after writing the setting. */
    invalidate(): void
  }
}

const sameApp = (
  a: IntegrationDefinition.InstanceConfig['github'],
  b: NonNullable<IntegrationDefinition.InstanceConfig['github']>,
) =>
  a?.apiUrl === b.apiUrl &&
  a.appId === b.appId &&
  a.privateKey === b.privateKey &&
  a.webhookSecret === b.webhookSecret

/**
 * Keeps one replica's live configuration in step with the `github_app` setting: with several
 * replicas on one database, the one that ran the manifest flow wrote the setting and updated its
 * own object at once, while the others hold the old one. `refresh` is a TTL-cached read; it
 * replaces `config.github` only when the stored App differs (a new object, so anything keyed on
 * the old one starts afresh) and never clears it: an unreadable or missing setting keeps what
 * the replica has. Concurrent refreshes share one read, and a failed read counts as a read (it is
 * not retried until the TTL passes).
 */
export function githubAppSync(options: githubAppSync.Options): githubAppSync.Sync {
  const ttl = options.ttlMs ?? GITHUB_APP_TTL_MS
  const now = options.now ?? Date.now
  let readAt = Number.NEGATIVE_INFINITY
  let inflight: Promise<boolean> | undefined

  async function read(): Promise<boolean> {
    let app: StoredGithubApp | undefined
    try {
      app = await readStoredGithubApp(options.db, options.authSecret)
    } finally {
      // Also after a database error: a down database is not asked again on every request.
      readAt = now()
    }
    if (!app || sameApp(options.config.github, app)) return false
    options.config.github = {
      apiUrl: app.apiUrl,
      appId: app.appId,
      privateKey: app.privateKey,
      webhookSecret: app.webhookSecret,
    }
    return true
  }

  return {
    refresh() {
      if (now() - readAt < ttl) return Promise.resolve(false)
      inflight ??= read().finally(() => {
        inflight = undefined
      })
      return inflight
    },
    invalidate() {
      readAt = Number.NEGATIVE_INFINITY
    },
  }
}

export type GithubAppSource = 'env' | 'manifest' | 'none'

type SourceDeps = Pick<Deps.Dashboard, 'githubApp' | 'integrations'>

/** Where the App's credentials came from. `githubApp` is the environment's. */
export function githubAppSource(deps: SourceDeps): GithubAppSource {
  if (deps.githubApp === true) return 'env'
  return deps.integrations?.config.github ? 'manifest' : 'none'
}

/** Whether the instance has a GitHub App now, however it was set up. */
export const githubConfigured = (deps: SourceDeps) => githubAppSource(deps) !== 'none'

/** The GitHub API this instance talks to: the App's, else `GITHUB_API_URL`, else github.com. */
export const githubApiUrl = (deps: Pick<Deps.Dashboard, 'integrations' | 'githubApiUrl'>) =>
  deps.integrations?.config.github?.apiUrl ?? deps.githubApiUrl ?? 'https://api.github.com'

const infos = new WeakMap<object, Promise<{ slug: string; htmlUrl: string } | null>>()

/** The App's slug and public page, asked of GitHub once per configuration (an environment App has no slug configured). */
export function resolveGithubApp(
  deps: Pick<Deps.Dashboard, 'integrations'>,
): Promise<{ slug: string; htmlUrl: string } | null> {
  const config = deps.integrations?.config.github
  if (!config) return Promise.resolve(null)
  let info = infos.get(config)
  if (!info) {
    const app = new GithubApp({
      ...config,
      ...(deps.integrations?.fetch ? { fetch: deps.integrations.fetch } : {}),
    })
    info = app
      .appInfo()
      .then((i) => (i.slug && i.htmlUrl ? { slug: i.slug, htmlUrl: i.htmlUrl } : null))
      .catch(() => null)
    infos.set(config, info)
  }
  return info.then((r) => {
    if (r === null) infos.delete(config)
    return r
  })
}

/**
 * Whether GitHub can deliver webhooks to the dashboard's address: `blocked` when it cannot be
 * used at all (plain http on a real host), `warning` for localhost (works to try, but GitHub
 * cannot reach it).
 */
export function publicUrlProblem(origin: string): {
  blocked: string | null
  warning: string | null
} {
  const url = new URL(origin)
  if (url.protocol === 'https:') return { blocked: null, warning: null }
  const host = url.hostname.replace(/^\[|\]$/g, '')
  const local =
    host === 'localhost' || host.endsWith('.localhost') || host === '127.0.0.1' || host === '::1'
  if (local) {
    return {
      blocked: null,
      warning:
        'This address is only reachable from this machine, so GitHub cannot deliver webhooks to it. Fine to try the setup; use a public https address for real use.',
    }
  }
  return {
    blocked: `PUBLIC_URL is ${origin}: GitHub only delivers webhooks to https addresses. Serve CirCI over https first.`,
    warning: null,
  }
}
