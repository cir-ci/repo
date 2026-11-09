import { isIP } from 'node:net'

import { isLocalAddress, parsePublicAddress } from './public-url.ts'
import { envSchema } from './schema.ts'
import { staticSitesHostProblem } from './sites-host.ts'
import type { Config } from './types.ts'

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

  let storage: Config.Storage
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
      connectTimeoutMs: Math.round(e.S3_CONNECT_TIMEOUT_SECONDS * 1000),
      requestTimeoutMs: Math.round(e.S3_REQUEST_TIMEOUT_SECONDS * 1000),
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

  let smtp: Config.Smtp | undefined
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

  let github: Config.GithubApp | undefined
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
  const githubApiUrl = e.GITHUB_API_URL?.replace(/\/$/, '')
  if (githubApiUrl && !/^https?:\/\//.test(githubApiUrl)) {
    if (!githubParts.some(Boolean)) issues.push('GITHUB_API_URL: must be an http(s) address')
  }
  let slack: Config.Slack | undefined
  if (e.SLACK_CLIENT_ID || e.SLACK_CLIENT_SECRET) {
    if (!(e.SLACK_CLIENT_ID && e.SLACK_CLIENT_SECRET)) {
      issues.push('SLACK_CLIENT_ID / SLACK_CLIENT_SECRET: set both, or neither')
    } else {
      const apiUrl = (e.SLACK_API_URL ?? 'https://slack.com/api').replace(/\/$/, '')
      if (!/^https?:\/\//.test(apiUrl)) issues.push('SLACK_API_URL: must be an http(s) address')
      slack = { clientId: e.SLACK_CLIENT_ID, clientSecret: e.SLACK_CLIENT_SECRET, apiUrl }
    }
  }
  let staticSites: Config.StaticSites | undefined
  if (e.STATIC_SITES_HOST) {
    const host = e.STATIC_SITES_HOST.trim().toLowerCase().replace(/\.$/, '')
    const problem = staticSitesHostProblem(
      host,
      typeof publicUrl === 'string' ? undefined : publicUrl.hostname,
    )
    if (problem) issues.push(`STATIC_SITES_HOST: ${problem}`)
    else staticSites = { host, maxBytes: e.STATIC_SITES_MAX_MB * 1024 * 1024 }
  }
  const sso: Config.Sso[] = []
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
  if (pair('AUTH_GITLAB', e.AUTH_GITLAB_CLIENT_ID, e.AUTH_GITLAB_CLIENT_SECRET)) {
    // A self-managed GitLab need not confirm its users' addresses: not trusted for email.
    sso.push({
      id: 'gitlab',
      name: 'GitLab',
      clientId: e.AUTH_GITLAB_CLIENT_ID ?? '',
      clientSecret: e.AUTH_GITLAB_CLIENT_SECRET ?? '',
      ...(e.AUTH_GITLAB_URL ? { issuer: e.AUTH_GITLAB_URL.replace(/\/$/, '') } : {}),
      trustedForEmail: false,
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

  const trustedProxies = parseTrustedProxies(e.TRUSTED_PROXIES, issues)

  if (issues.length > 0 || typeof publicUrl === 'string') throw new ConfigError(issues)

  return {
    env: e.NODE_ENV,
    logLevel: e.LOG_LEVEL,
    http: { host: e.HOST, port: e.PORT },
    publicUrl,
    previousPublicHosts,
    trustedProxies: trustedProxies ?? [],
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
    ...(githubApiUrl ? { githubApiUrl } : {}),
    ...(slack ? { slack } : {}),
    webhookAllowPrivate: e.WEBHOOK_ALLOW_PRIVATE_ADDRESSES === true,
    uploadTimeoutMinutes: e.UPLOAD_TIMEOUT_MINUTES,
    gcGraceHours: e.GC_GRACE_HOURS,
    workspaceCreation: e.WORKSPACE_CREATION,
  }
}

function isAddressOrCidr(entry: string): boolean {
  const [address = '', prefix, ...rest] = entry.split('/')
  const family = isIP(address)
  if (family === 0 || rest.length > 0) return false
  if (prefix === undefined) return true
  return /^\d{1,3}$/.test(prefix) && Number(prefix) <= (family === 4 ? 32 : 128)
}

function parseTrustedProxies(
  raw: string | undefined,
  issues: string[],
): true | string[] | undefined {
  const value = raw?.trim() ?? ''
  if (value === '' || value.toLowerCase() === 'false') return undefined
  if (value.toLowerCase() === 'true') return true
  const entries = value
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean)
  const bad = entries.filter((v) => !isAddressOrCidr(v))
  if (bad.length > 0) {
    issues.push(
      `TRUSTED_PROXIES: "${bad.join('", "')}" is not an IP address or CIDR range ` +
        '(expected e.g. 10.0.0.1, 172.16.0.0/12, or true to trust any hop)',
    )
    return undefined
  }
  return entries
}
