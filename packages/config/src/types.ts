import type { InstanceLockKey } from '@circi/core'

import type { PublicAddress } from './public-url.ts'

export namespace Config {
  /** A single sign-on provider the operator configured (instance-scoped, PLAN §7.8). */
  export interface Sso {
    id: 'github' | 'gitlab' | 'google' | 'oidc'
    name: string
    clientId: string
    clientSecret: string
    issuer?: string
    trustedForEmail: boolean
  }

  /** The instance's GitHub App (PLAN §7.4). */
  export interface GithubApp {
    appId: string
    /** PEM. `\n` escapes in the environment variable are turned into newlines. */
    privateKey: string
    webhookSecret: string
    /** `https://api.github.com`, or a GitHub Enterprise Server's `https://host/api/v3`. */
    apiUrl: string
    /** Give up on one API request after this long (`GITHUB_API_TIMEOUT_SECONDS`, default 15 s). */
    timeoutMs: number
  }

  /** The Slack app that installs into workspaces (`SLACK_CLIENT_ID` / `SLACK_CLIENT_SECRET`). */
  export interface Slack {
    clientId: string
    clientSecret: string
    /** `https://slack.com/api`, or a stand-in for tests. */
    apiUrl: string
  }

  /** Hosted static sites, served from their own domain (PLAN §7.6). */
  export interface StaticSites {
    /** The dedicated domain, e.g. `example-sites.com`: sites live at `<hash>-<slug>.<host>`. */
    host: string
    /** Largest site (uncompressed) accepted, in bytes. */
    maxBytes: number
  }

  export type Storage =
    | { driver: 'fs'; path: string }
    | {
        driver: 's3'
        bucket: string
        region: string
        endpoint?: string
        forcePathStyle: boolean
        credentials?: { accessKeyId: string; secretAccessKey: string }
        /** Give up connecting after this long (`S3_CONNECT_TIMEOUT_SECONDS`). */
        connectTimeoutMs: number
        /** Give up when a request's socket is silent this long (`S3_REQUEST_TIMEOUT_SECONDS`). */
        requestTimeoutMs: number
      }

  /** Web push (VAPID) identity from the environment; absent: the server keeps its own pair in the database. */
  export interface Vapid {
    publicKey: string
    privateKey: string
  }

  export interface Smtp {
    host: string
    port: number
    /** Implicit TLS (port 465). Otherwise STARTTLS is used when the server offers it. */
    secure: boolean
    auth?: { user: string; password: string }
    /** The From address, e.g. `CirCI <ci@acme.io>`. */
    from: string
  }
}

export interface Config {
  env: 'development' | 'production' | 'test'
  logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace'
  http: { host: string; port: number }
  /** The dashboard address (`PUBLIC_URL`). Any host you own; see PLAN §7.9. */
  publicUrl: PublicAddress
  /**
   * Hosts the dashboard used to live on (`PREVIOUS_PUBLIC_URLS`). Requests to them are
   * redirected to `publicUrl`, so old links in PR comments and emails keep working.
   */
  previousPublicHosts: string[]
  /**
   * Reverse proxies whose `X-Forwarded-For` is believed (`TRUSTED_PROXIES`): addresses or CIDR
   * ranges, `true` for any hop (unsafe), or an empty list (the default) for none: the client is
   * then the socket's remote address and forwarded headers are ignored.
   */
  trustedProxies: true | string[]
  /** Signs sessions and cookies (BETTER_AUTH_SECRET). Rotating it signs everyone out. */
  authSecret: string
  /** Settings that work but are probably a mistake; logged at startup. */
  warnings: string[]
  database: { url: string; poolMax: number }
  /** Where the image ships the migrations (`CIRCI_MIGRATIONS`); absent: the source tree's. */
  migrationsFolder?: string
  /** Where the image ships the dashboard (`CIRCI_WEB_DIST`); absent: apps/web/dist. */
  webDist?: string
  storage: Config.Storage
  /** Outgoing mail (`SMTP_*`); absent when no SMTP server is configured. */
  smtp?: Config.Smtp
  /** Web push signing keys from `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY`; absent: generated on first use and kept in the database. */
  vapid?: Config.Vapid
  /** The contact in push requests (`VAPID_SUBJECT`, default the dashboard's address). */
  vapidSubject: string
  /**
   * The instance settings an admin can also change in the dashboard (Instance › Settings), whose
   * environment variable is set: the variable wins and the dashboard shows them locked. Every
   * other value below that has such a variable is only the initial value (the default when unset).
   */
  lockedSettings: InstanceLockKey[]
  /** Email login (one-time code / link) is switched on (`AUTH_EMAIL_ENABLED`, default on); it is offered once SMTP is set up. */
  emailEnabled: boolean
  /** Largest hosted site in MB (`STATIC_SITES_MAX_MB`, default 200). */
  staticSitesMaxMb: number
  /** Static site hosting: absent unless `STATIC_SITES_HOST` is set. */
  staticSites?: Config.StaticSites
  /** Pixel comparison engine of the diff step (`CIRCI_DIFF_ENGINE`, default `native`). */
  diffEngine: 'js' | 'js-workers' | 'native'
  /** Threads of the `js-workers` engine (`CIRCI_DIFF_THREADS`); absent means one less than the cores, at least 1. */
  diffThreads?: number
  /** Hours a file nobody uses waits before it is deleted (`GC_GRACE_HOURS`). */
  gcGraceHours: number
  /** Days a finished (done or failed) background job is kept before it is pruned; 0 keeps them (`JOB_RETENTION_DAYS`). */
  jobRetentionDays: number
  /** Builds still uploading after this many minutes fail; 0 never does (`UPLOAD_TIMEOUT_MINUTES`). */
  uploadTimeoutMinutes: number
  /** The GitHub App: absent when none is configured. */
  github?: Config.GithubApp
  /**
   * `GITHUB_API_URL` when set, with or without an App configured: the GitHub the manifest flow
   * creates the App on (GitHub Enterprise Server). Absent means github.com.
   */
  githubApiUrl?: string
  /** The Slack app: absent when none is configured, and Slack then cannot be added. */
  slack?: Config.Slack
  /** Single sign-on providers from `AUTH_*` variables (read-only in the dashboard, which can add more). */
  sso: Config.Sso[]
  /** Single sign-on is switched on (`AUTH_SSO_ENABLED`, default on). */
  ssoEnabled: boolean
  /** Email + password sign-in is offered (`AUTH_PASSWORD_ENABLED`, default on). */
  passwordLogin: boolean
  /** Webhooks may point at private/loopback addresses (`WEBHOOK_ALLOW_PRIVATE_ADDRESSES`). */
  webhookAllowPrivate: boolean
  /** Waits between attempts of a failed job: `baseMs` doubling each time, never above `maxMs`. */
  jobRetry: { baseMs: number; maxMs: number }
  /** The most live streams one server process keeps open (`LIVE_MAX_STREAMS`). */
  liveMaxStreams: number
  /** A webhook receiver that takes longer than this to answer has failed (`WEBHOOK_TIMEOUT_SECONDS`). */
  webhookTimeoutMs: number
  /** Who may create workspaces in the dashboard (`WORKSPACE_CREATION`): instance admins only, or any member. */
  workspaceCreation: 'admin' | 'anyone'
}
