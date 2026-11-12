/**
 * The instance-wide settings an operator can change in the dashboard (Instance › Settings), and the
 * rules about them that need no I/O: the bounds of each limit, the environment variable that locks
 * each one, and the "nobody could sign in" check.
 *
 * Precedence, for every setting: the environment variable, when set, wins and locks the setting
 * ("Set by <ENV_VAR>"); otherwise the value saved in the dashboard; otherwise the default.
 */

export const WORKSPACE_CREATIONS = ['admin', 'anyone'] as const
export type WorkspaceCreation = (typeof WORKSPACE_CREATIONS)[number]

export interface InstanceLimits {
  /** Retention in days that a new project starts with (no environment variable). */
  defaultProjectRetentionDays: number
  /** Hours a file nobody uses waits before it is deleted. */
  gcGraceHours: number
  /** Minutes after which a build still uploading fails; 0 never. */
  uploadTimeoutMinutes: number
  /** Days a finished background job is kept; 0 keeps them. */
  jobRetentionDays: number
  /** Largest hosted site, in MB. */
  staticSitesMaxMb: number
  /** Seconds a webhook receiver may take to answer. */
  webhookTimeoutSeconds: number
}

export type InstanceLimitKey = keyof InstanceLimits

export const INSTANCE_LIMIT_KEYS: InstanceLimitKey[] = [
  'defaultProjectRetentionDays',
  'gcGraceHours',
  'uploadTimeoutMinutes',
  'jobRetentionDays',
  'staticSitesMaxMb',
  'webhookTimeoutSeconds',
]

export const INSTANCE_LIMIT_BOUNDS: Record<
  InstanceLimitKey,
  { min: number; max: number; integer: boolean; label: string }
> = {
  defaultProjectRetentionDays: { min: 1, max: 3650, integer: true, label: 'Default retention' },
  gcGraceHours: { min: 0, max: 8760, integer: true, label: 'Unused file grace period' },
  uploadTimeoutMinutes: { min: 0, max: 10_080, integer: true, label: 'Upload timeout' },
  jobRetentionDays: { min: 0, max: 3650, integer: true, label: 'Job retention' },
  staticSitesMaxMb: { min: 1, max: 5000, integer: true, label: 'Largest hosted site' },
  webhookTimeoutSeconds: { min: 1, max: 600, integer: false, label: 'Webhook timeout' },
}

export const INSTANCE_LIMIT_DEFAULTS: InstanceLimits = {
  defaultProjectRetentionDays: 30,
  gcGraceHours: 24,
  uploadTimeoutMinutes: 60,
  jobRetentionDays: 14,
  staticSitesMaxMb: 200,
  webhookTimeoutSeconds: 10,
}

/** The environment variable that sets (and so locks) each setting; none for the default retention. */
export const INSTANCE_ENV = {
  workspaceCreation: 'WORKSPACE_CREATION',
  signInPassword: 'AUTH_PASSWORD_ENABLED',
  signInEmail: 'AUTH_EMAIL_ENABLED',
  signInSso: 'AUTH_SSO_ENABLED',
  gcGraceHours: 'GC_GRACE_HOURS',
  uploadTimeoutMinutes: 'UPLOAD_TIMEOUT_MINUTES',
  jobRetentionDays: 'JOB_RETENTION_DAYS',
  staticSitesMaxMb: 'STATIC_SITES_MAX_MB',
  webhookTimeoutSeconds: 'WEBHOOK_TIMEOUT_SECONDS',
  smtp: 'SMTP_HOST',
  slack: 'SLACK_CLIENT_ID',
} as const

export type InstanceLockKey = keyof typeof INSTANCE_ENV

export const INSTANCE_LOCK_KEYS: InstanceLockKey[] = [
  'workspaceCreation',
  'signInPassword',
  'signInEmail',
  'signInSso',
  'gcGraceHours',
  'uploadTimeoutMinutes',
  'jobRetentionDays',
  'staticSitesMaxMb',
  'webhookTimeoutSeconds',
  'smtp',
  'slack',
]

/** Why a limit's value is refused, in a sentence; null when it is fine. */
export function limitProblem(key: InstanceLimitKey, value: unknown): string | null {
  const bounds = INSTANCE_LIMIT_BOUNDS[key]
  const ok =
    typeof value === 'number' &&
    Number.isFinite(value) &&
    (!bounds.integer || Number.isInteger(value)) &&
    value >= bounds.min &&
    value <= bounds.max
  if (ok) return null
  return `${bounds.label} must be ${bounds.integer ? 'a whole number ' : 'a number '}from ${bounds.min} to ${bounds.max}`
}

export interface SignInAvailability {
  password: boolean
  /** Email codes are switched on. */
  email: boolean
  /** Mail can be sent (SMTP is set up). */
  mailConfigured: boolean
  /** Single sign-on is switched on. */
  sso: boolean
  /** Providers configured for the whole instance. */
  ssoProviders: number
}

export type SignInMethodKind = 'password' | 'email' | 'sso'

/** The sign-in methods that work for this availability. */
export function workingSignInMethods(a: SignInAvailability): SignInMethodKind[] {
  return [
    ...(a.password ? (['password'] as const) : []),
    ...(a.email && a.mailConfigured ? (['email'] as const) : []),
    ...(a.sso && a.ssoProviders > 0 ? (['sso'] as const) : []),
  ]
}

/**
 * The refusal for a sign-in change that would leave nobody able to sign in, or that turns off the
 * way the person making it signed in while nothing else would work for them; null when it is fine.
 * `using` is the kind of the admin's own session.
 */
export function signInLockout(
  after: SignInAvailability,
  using: SignInMethodKind | undefined,
): string | null {
  const working = workingSignInMethods(after)
  if (working.length === 0) {
    return (
      'Nobody could sign in with these settings. Keep password sign-in on, or turn on email codes ' +
      'with a mail server set up, or single sign-on with a provider configured.'
    )
  }
  if (using !== undefined && !working.includes(using)) {
    const names = { password: 'password', email: 'email code', sso: 'single sign-on' } as const
    return `You're signed in with ${names[using]}, which these settings turn off. Turn that method back on, or save this from a session that uses a method that stays on.`
  }
  return null
}

/** A mail server's fields, as the admin enters them. */
export interface SmtpFields {
  host: string
  port: number
  /** Implicit TLS (port 465). Otherwise STARTTLS is used when the server offers it. */
  secure: boolean
  user: string
  from: string
}

export function smtpProblems(
  fields: SmtpFields,
  hasPassword: boolean,
): Partial<Record<keyof SmtpFields | 'password', string>> {
  const problems: Partial<Record<keyof SmtpFields | 'password', string>> = {}
  if (!fields.host.trim() || /\s/.test(fields.host.trim())) problems.host = 'Enter the server host'
  if (!Number.isInteger(fields.port) || fields.port < 1 || fields.port > 65_535) {
    problems.port = 'Port must be from 1 to 65535'
  }
  if (!fields.from.trim()) problems.from = 'Enter the From address'
  else if (!fields.from.includes('@')) problems.from = 'Enter an address, like ci@acme.io'
  if (fields.user.trim() === '' && hasPassword) {
    problems.user = 'Enter the user name that goes with the password'
  }
  return problems
}
