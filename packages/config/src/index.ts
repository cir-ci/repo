import { z } from 'zod'

import { isLocalAddress, type PublicAddress, parsePublicAddress } from './public-url.ts'

export { isLocalAddress, type PublicAddress, parsePublicAddress } from './public-url.ts'

const bool = z
  .enum(['true', 'false', '1', '0', 'yes', 'no'])
  .transform((v) => v === 'true' || v === '1' || v === 'yes')

const emptyToUndefined = (v: unknown) => (v === '' ? undefined : v)

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('production'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  PUBLIC_URL: z.string().default('http://localhost:3000'),
  PREVIOUS_PUBLIC_URLS: z.string().default(''),
  BETTER_AUTH_SECRET: z
    .string({ error: 'is required (generate one with: openssl rand -base64 32)' })
    .min(32, 'must be at least 32 characters (generate one with: openssl rand -base64 32)'),
  DATABASE_URL: z.string({ error: 'is required' }).min(1, 'is required'),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).default(10),
  STORAGE_DRIVER: z.enum(['fs', 's3']).default('fs'),
  STORAGE_PATH: z.string().default('/var/lib/circi/files'),
  S3_BUCKET: z.preprocess(emptyToUndefined, z.string().optional()),
  S3_REGION: z.string().default('us-east-1'),
  S3_ENDPOINT: z.preprocess(emptyToUndefined, z.url().optional()),
  S3_FORCE_PATH_STYLE: z.preprocess(emptyToUndefined, bool.optional()),
  S3_ACCESS_KEY_ID: z.preprocess(emptyToUndefined, z.string().optional()),
  S3_SECRET_ACCESS_KEY: z.preprocess(emptyToUndefined, z.string().optional()),
  SMTP_HOST: z.preprocess(emptyToUndefined, z.string().optional()),
  SMTP_PORT: z.preprocess(emptyToUndefined, z.coerce.number().int().min(1).max(65535).optional()),
  SMTP_SECURE: z.preprocess(emptyToUndefined, bool.optional()),
  SMTP_USER: z.preprocess(emptyToUndefined, z.string().optional()),
  SMTP_PASSWORD: z.preprocess(emptyToUndefined, z.string().optional()),
  SMTP_FROM: z.preprocess(emptyToUndefined, z.string().optional()),
  AUTH_EMAIL_ENABLED: z.preprocess(emptyToUndefined, bool.optional()),
  WEBHOOK_ALLOW_PRIVATE_ADDRESSES: z.preprocess(emptyToUndefined, bool.optional()),
  GITHUB_APP_ID: z.preprocess(emptyToUndefined, z.string().optional()),
  GITHUB_APP_PRIVATE_KEY: z.preprocess(emptyToUndefined, z.string().optional()),
  GITHUB_APP_WEBHOOK_SECRET: z.preprocess(emptyToUndefined, z.string().optional()),
  GITHUB_API_URL: z.preprocess(emptyToUndefined, z.string().optional()),
  STATIC_SITES_HOST: z.preprocess(emptyToUndefined, z.string().optional()),
  STATIC_SITES_MAX_MB: z.preprocess(
    emptyToUndefined,
    z.coerce.number().int().min(1).max(5000).default(200),
  ),
  UPLOAD_TIMEOUT_MINUTES: z.preprocess(
    emptyToUndefined,
    z.coerce.number().int().min(0).default(60),
  ),
  AUTH_PASSWORD_ENABLED: z.preprocess(emptyToUndefined, bool.optional()),
  AUTH_SSO_ENABLED: z.preprocess(emptyToUndefined, bool.optional()),
  AUTH_GITHUB_CLIENT_ID: z.preprocess(emptyToUndefined, z.string().optional()),
  AUTH_GITHUB_CLIENT_SECRET: z.preprocess(emptyToUndefined, z.string().optional()),
  AUTH_GOOGLE_CLIENT_ID: z.preprocess(emptyToUndefined, z.string().optional()),
  AUTH_GOOGLE_CLIENT_SECRET: z.preprocess(emptyToUndefined, z.string().optional()),
  AUTH_OIDC_ISSUER: z.preprocess(emptyToUndefined, z.string().optional()),
  AUTH_OIDC_CLIENT_ID: z.preprocess(emptyToUndefined, z.string().optional()),
  AUTH_OIDC_CLIENT_SECRET: z.preprocess(emptyToUndefined, z.string().optional()),
  AUTH_OIDC_NAME: z.preprocess(emptyToUndefined, z.string().optional()),
  AUTH_OIDC_TRUSTED_FOR_EMAIL: z.preprocess(emptyToUndefined, bool.optional()),
  ORG_CREATION: z.preprocess(emptyToUndefined, z.enum(['admin', 'anyone']).default('admin')),
})

/** A single sign-on provider the operator configured (instance-scoped, PLAN §7.8). */
export interface SsoConfig {
  id: 'github' | 'google' | 'oidc'
  name: string
  clientId: string
  clientSecret: string
  issuer?: string
  trustedForEmail: boolean
}

/** The instance's GitHub App (PLAN §7.4). */
export interface GithubAppConfig {
  appId: string
  /** PEM. `\n` escapes in the environment variable are turned into newlines. */
  privateKey: string
  webhookSecret: string
  /** `https://api.github.com`, or a GitHub Enterprise Server's `https://host/api/v3`. */
  apiUrl: string
}

/** Hosted static sites, served from their own domain (PLAN §7.6). */
export interface StaticSitesConfig {
  /** The dedicated domain, e.g. `example-sites.com`: sites live at `<hash>-<slug>.<host>`. */
  host: string
  /** Largest site (uncompressed) accepted, in bytes. */
  maxBytes: number
}

export type StorageConfig =
  | { driver: 'fs'; path: string }
  | {
      driver: 's3'
      bucket: string
      region: string
      endpoint?: string
      forcePathStyle: boolean
      credentials?: { accessKeyId: string; secretAccessKey: string }
    }

export interface SmtpConfig {
  host: string
  port: number
  /** Implicit TLS (port 465). Otherwise STARTTLS is used when the server offers it. */
  secure: boolean
  auth?: { user: string; password: string }
  /** The From address, e.g. `CirCI <ci@acme.io>`. */
  from: string
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
  /** Signs sessions and cookies (BETTER_AUTH_SECRET). Rotating it signs everyone out. */
  authSecret: string
  /** Settings that work but are probably a mistake; logged at startup. */
  warnings: string[]
  database: { url: string; poolMax: number }
  storage: StorageConfig
  /** Outgoing mail (`SMTP_*`); absent when no SMTP server is configured. */
  smtp?: SmtpConfig
  /** Email login (one-time code / link) is offered: switched on (default) and SMTP is set up. */
  emailLogin: boolean
  /** Static site hosting: absent unless `STATIC_SITES_HOST` is set. */
  staticSites?: StaticSitesConfig
  /** Builds still uploading after this many minutes fail; 0 never does (`UPLOAD_TIMEOUT_MINUTES`). */
  uploadTimeoutMinutes: number
  /** Webhooks may point at private/loopback addresses (`WEBHOOK_ALLOW_PRIVATE_ADDRESSES`). */
  /** The GitHub App: absent when none is configured. */
  github?: GithubAppConfig
  /** Single sign-on providers, empty when none is configured or `AUTH_SSO_ENABLED=false`. */
  sso: SsoConfig[]
  /** Email + password sign-in is offered (`AUTH_PASSWORD_ENABLED`, default on). */
  passwordLogin: boolean
  webhookAllowPrivate: boolean
  /** Who may create organizations in the dashboard: instance admins only, or any member. */
  orgCreation: 'admin' | 'anyone'
}

export class ConfigError extends Error {
  readonly issues: string[]
  constructor(issues: string[]) {
    super(`Invalid configuration:\n${issues.map((i) => `  - ${i}`).join('\n')}`)
    this.name = 'ConfigError'
    this.issues = issues
  }
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const parsed = envSchema.safeParse(env)
  if (!parsed.success) {
    throw new ConfigError(
      parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
    )
  }
  const e = parsed.data
  const issues: string[] = []
  const warnings: string[] = []

  const publicUrl = parsePublicAddress(e.PUBLIC_URL, 'PUBLIC_URL')
  if (typeof publicUrl === 'string') issues.push(publicUrl)
  else if (publicUrl.protocol === 'http:' && !isLocalAddress(publicUrl)) {
    warnings.push(
      `PUBLIC_URL uses plain http on ${publicUrl.host}. Logins need https outside local development; put a TLS proxy such as Caddy in front and use https://${publicUrl.host}.`,
    )
  }

  const previousPublicHosts: string[] = []
  for (const raw of e.PREVIOUS_PUBLIC_URLS.split(',')
    .map((s) => s.trim())
    .filter(Boolean)) {
    const prev = parsePublicAddress(raw, 'PREVIOUS_PUBLIC_URLS')
    if (typeof prev === 'string') issues.push(prev)
    else if (typeof publicUrl !== 'string' && prev.host === publicUrl.host) {
      issues.push(`PREVIOUS_PUBLIC_URLS: ${prev.host} is the current PUBLIC_URL host`)
    } else if (!previousPublicHosts.includes(prev.host)) previousPublicHosts.push(prev.host)
  }

  let storage: StorageConfig
  if (e.STORAGE_DRIVER === 's3') {
    if (!e.S3_BUCKET) issues.push('S3_BUCKET: required when STORAGE_DRIVER=s3')
    if (Boolean(e.S3_ACCESS_KEY_ID) !== Boolean(e.S3_SECRET_ACCESS_KEY)) {
      issues.push(
        'S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY: set both, or neither to use the default AWS credential chain (e.g. an IAM role)',
      )
    }
    storage = {
      driver: 's3',
      bucket: e.S3_BUCKET ?? '',
      region: e.S3_REGION,
      ...(e.S3_ENDPOINT ? { endpoint: e.S3_ENDPOINT } : {}),
      forcePathStyle: e.S3_FORCE_PATH_STYLE ?? Boolean(e.S3_ENDPOINT),
      ...(e.S3_ACCESS_KEY_ID && e.S3_SECRET_ACCESS_KEY
        ? {
            credentials: {
              accessKeyId: e.S3_ACCESS_KEY_ID,
              secretAccessKey: e.S3_SECRET_ACCESS_KEY,
            },
          }
        : {}),
    }
  } else {
    storage = { driver: 'fs', path: e.STORAGE_PATH }
  }

  let smtp: SmtpConfig | undefined
  if (e.SMTP_HOST) {
    if (!e.SMTP_FROM) issues.push('SMTP_FROM: required when SMTP_HOST is set')
    if (Boolean(e.SMTP_USER) !== Boolean(e.SMTP_PASSWORD)) {
      issues.push('SMTP_USER / SMTP_PASSWORD: set both, or neither for a server without login')
    }
    const port = e.SMTP_PORT ?? (e.SMTP_SECURE ? 465 : 587)
    smtp = {
      host: e.SMTP_HOST,
      port,
      secure: e.SMTP_SECURE ?? port === 465,
      from: e.SMTP_FROM ?? '',
      ...(e.SMTP_USER && e.SMTP_PASSWORD
        ? { auth: { user: e.SMTP_USER, password: e.SMTP_PASSWORD } }
        : {}),
    }
  }
  if (e.AUTH_EMAIL_ENABLED === true && !smtp) {
    warnings.push('AUTH_EMAIL_ENABLED is on but SMTP_HOST is not set, so email login is off.')
  }

  let github: GithubAppConfig | undefined
  const githubParts = [e.GITHUB_APP_ID, e.GITHUB_APP_PRIVATE_KEY, e.GITHUB_APP_WEBHOOK_SECRET]
  if (githubParts.some(Boolean)) {
    if (!githubParts.every(Boolean)) {
      issues.push(
        'GITHUB_APP_ID / GITHUB_APP_PRIVATE_KEY / GITHUB_APP_WEBHOOK_SECRET: set all three',
      )
    } else {
      const apiUrl = (e.GITHUB_API_URL ?? 'https://api.github.com').replace(/\/$/, '')
      if (!/^https?:\/\//.test(apiUrl)) issues.push('GITHUB_API_URL: must be an http(s) address')
      github = {
        appId: e.GITHUB_APP_ID ?? '',
        privateKey: (e.GITHUB_APP_PRIVATE_KEY ?? '').replace(/\\n/g, '\n'),
        webhookSecret: e.GITHUB_APP_WEBHOOK_SECRET ?? '',
        apiUrl,
      }
    }
  }
  let staticSites: StaticSitesConfig | undefined
  if (e.STATIC_SITES_HOST) {
    const host = e.STATIC_SITES_HOST.trim().toLowerCase().replace(/\.$/, '')
    const problem = staticSitesHostProblem(
      host,
      typeof publicUrl === 'string' ? undefined : publicUrl.hostname,
    )
    if (problem) issues.push(`STATIC_SITES_HOST: ${problem}`)
    else staticSites = { host, maxBytes: e.STATIC_SITES_MAX_MB * 1024 * 1024 }
  }
  const sso: SsoConfig[] = []
  const pair = (name: string, id: string | undefined, secret: string | undefined) => {
    if (Boolean(id) !== Boolean(secret)) {
      issues.push(`${name}_CLIENT_ID / ${name}_CLIENT_SECRET: set both, or neither`)
      return false
    }
    return Boolean(id && secret)
  }
  if (pair('AUTH_GITHUB', e.AUTH_GITHUB_CLIENT_ID, e.AUTH_GITHUB_CLIENT_SECRET)) {
    // GitHub reports the primary email only when it is verified.
    sso.push({
      id: 'github',
      name: 'GitHub',
      clientId: e.AUTH_GITHUB_CLIENT_ID ?? '',
      clientSecret: e.AUTH_GITHUB_CLIENT_SECRET ?? '',
      trustedForEmail: true,
    })
  }
  if (pair('AUTH_GOOGLE', e.AUTH_GOOGLE_CLIENT_ID, e.AUTH_GOOGLE_CLIENT_SECRET)) {
    sso.push({
      id: 'google',
      name: 'Google',
      clientId: e.AUTH_GOOGLE_CLIENT_ID ?? '',
      clientSecret: e.AUTH_GOOGLE_CLIENT_SECRET ?? '',
      trustedForEmail: true,
    })
  }
  const oidcParts = [e.AUTH_OIDC_ISSUER, e.AUTH_OIDC_CLIENT_ID, e.AUTH_OIDC_CLIENT_SECRET]
  if (oidcParts.some(Boolean)) {
    if (!oidcParts.every(Boolean)) {
      issues.push('AUTH_OIDC_ISSUER / AUTH_OIDC_CLIENT_ID / AUTH_OIDC_CLIENT_SECRET: set all three')
    } else if (!/^https?:\/\//.test(e.AUTH_OIDC_ISSUER ?? '')) {
      issues.push('AUTH_OIDC_ISSUER: must be an https:// address (the issuer URL)')
    } else {
      sso.push({
        id: 'oidc',
        name: e.AUTH_OIDC_NAME ?? 'Single sign-on',
        clientId: e.AUTH_OIDC_CLIENT_ID ?? '',
        clientSecret: e.AUTH_OIDC_CLIENT_SECRET ?? '',
        issuer: e.AUTH_OIDC_ISSUER ?? '',
        // Not every identity provider checks that its users own the addresses they claim.
        trustedForEmail: e.AUTH_OIDC_TRUSTED_FOR_EMAIL === true,
      })
    }
  }
  const ssoOn = e.AUTH_SSO_ENABLED !== false ? sso : []
  const passwordLogin = e.AUTH_PASSWORD_ENABLED !== false
  const emailLogin = Boolean(smtp) && e.AUTH_EMAIL_ENABLED !== false
  if (!passwordLogin && !emailLogin && ssoOn.length === 0) {
    issues.push(
      'AUTH_PASSWORD_ENABLED is off and neither email login nor single sign-on is available: ' +
        'nobody could sign in. Turn password sign-in on, set up SMTP, or configure a provider',
    )
  }

  if (issues.length > 0 || typeof publicUrl === 'string') throw new ConfigError(issues)

  return {
    env: e.NODE_ENV,
    logLevel: e.LOG_LEVEL,
    http: { host: e.HOST, port: e.PORT },
    publicUrl,
    previousPublicHosts,
    warnings,
    authSecret: e.BETTER_AUTH_SECRET,
    database: { url: e.DATABASE_URL, poolMax: e.DATABASE_POOL_MAX },
    storage,
    ...(smtp ? { smtp } : {}),
    emailLogin,
    passwordLogin,
    sso: ssoOn,
    ...(staticSites ? { staticSites } : {}),
    ...(github ? { github } : {}),
    webhookAllowPrivate: e.WEBHOOK_ALLOW_PRIVATE_ADDRESSES === true,
    uploadTimeoutMinutes: e.UPLOAD_TIMEOUT_MINUTES,
    orgCreation: e.ORG_CREATION,
  }
}

const parentDomain = (h: string) => h.split('.').slice(1).join('.')

/**
 * Why `host` can't be the sites domain, or undefined. Uploaded sites run arbitrary JavaScript, so
 * they must not share a cookie scope with the dashboard: the domain has to be unrelated to it
 * (not the same host, not a parent of it, not a child of it).
 */
export function staticSitesHostProblem(
  host: string,
  dashboardHostname: string | undefined,
): string | undefined {
  if (!/^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(host)) {
    return `"${host}" is not a domain name (expected e.g. example-sites.com, without https:// or a port)`
  }
  if (!dashboardHostname) return undefined
  const dash = dashboardHostname.toLowerCase()
  if (dash === host)
    return 'must differ from the dashboard host: sites run uploaded code and must not share its cookies'
  if (dash.endsWith(`.${host}`))
    return `is a parent of the dashboard host ${dash}: use a separate domain`
  if (host.endsWith(`.${dash}`)) return `is below the dashboard host ${dash}: use a separate domain`
  // Siblings under one parent domain (ci.acme.io and sites.acme.io) can set cookies on acme.io.
  if (parentDomain(dash).includes('.') && parentDomain(dash) === parentDomain(host)) {
    return `shares the parent domain ${parentDomain(dash)} with the dashboard: a site could set cookies for both. Use a different registrable domain`
  }
  return undefined
}
