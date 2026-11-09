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
  /** Email login (one-time code / link) is offered: switched on (default) and SMTP is set up. */
  emailLogin: boolean
  /** Static site hosting: absent unless `STATIC_SITES_HOST` is set. */
  staticSites?: Config.StaticSites
  /** Hours a file nobody uses waits before it is deleted (`GC_GRACE_HOURS`). */
  gcGraceHours: number
  /** Builds still uploading after this many minutes fail; 0 never does (`UPLOAD_TIMEOUT_MINUTES`). */
  uploadTimeoutMinutes: number
  /** Webhooks may point at private/loopback addresses (`WEBHOOK_ALLOW_PRIVATE_ADDRESSES`). */
  /** The GitHub App: absent when none is configured. */
  github?: Config.GithubApp
  /**
   * `GITHUB_API_URL` when set, with or without an App configured: the GitHub the manifest flow
   * creates the App on (GitHub Enterprise Server). Absent means github.com.
   */
  githubApiUrl?: string
  /** The Slack app: absent when none is configured, and Slack then cannot be added. */
  slack?: Config.Slack
  /** Single sign-on providers, empty when none is configured or `AUTH_SSO_ENABLED=false`. */
  sso: Config.Sso[]
  /** Email + password sign-in is offered (`AUTH_PASSWORD_ENABLED`, default on). */
  passwordLogin: boolean
  webhookAllowPrivate: boolean
  /** Who may create workspaces in the dashboard: instance admins only, or any member. */
  workspaceCreation: 'admin' | 'anyone'
}
