import {
  INSTANCE_ENV,
  INSTANCE_LIMIT_DEFAULTS,
  type InstanceLimitKey,
  type InstanceLimits,
  type InstanceLockKey,
  type SignInAvailability,
  type WorkspaceCreation,
} from '@circi/core'

/**
 * The instance's configuration in three layers: the environment (`Env`: what `loadConfig` read,
 * with the names of the variables that were set), what an instance admin saved in the dashboard
 * (`Stored`), and the defaults. `resolve` puts them together: a variable that is set wins and
 * locks the setting; otherwise the saved value; otherwise the default.
 */

export namespace InstanceConfig {
  export interface Smtp {
    host: string
    port: number
    /** Implicit TLS (port 465). Otherwise STARTTLS is used when the server offers it. */
    secure: boolean
    auth?: { user: string; password: string }
    from: string
  }

  export interface Slack {
    clientId: string
    clientSecret: string
    /** `https://slack.com/api`, or a stand-in for tests (environment only). */
    apiUrl?: string
  }

  export interface Sso {
    id: 'github' | 'gitlab' | 'google' | 'oidc'
    name: string
    clientId: string
    clientSecret: string
    issuer?: string
    trustedForEmail: boolean
  }

  export interface SignIn {
    password: boolean
    email: boolean
    sso: boolean
  }

  /** What the environment says, with the names of the variables that were set. */
  export interface Env {
    /** The settings whose variable is set: they are locked. */
    locked: readonly InstanceLockKey[]
    workspaceCreation: WorkspaceCreation
    signIn: SignIn
    /** Each limit's variable value or default; `defaultProjectRetentionDays` has no variable. */
    limits: InstanceLimits
    smtp?: Smtp
    slack?: Slack
    /** Providers from `AUTH_*` variables: always listed, never editable. */
    sso: Sso[]
  }

  /** What the dashboard saved. A missing field was never saved. */
  export interface Stored {
    workspaceCreation?: WorkspaceCreation
    signIn: Partial<SignIn>
    limits: Partial<InstanceLimits>
    smtp?: Smtp
    slack?: Slack
    sso: Sso[]
    /**
     * Saved secrets that couldn't be opened with the current instance secret (it was rotated). The
     * group's other fields are still shown, with an empty secret, but it is never used, and a save
     * of another group never touches it. `sso` maps a provider to its sealed secret as saved, so
     * saving another provider writes it back as it was.
     */
    unreadable: { smtp: boolean; slack: boolean; sso: Record<string, string> }
  }

  /** What the rest of the program uses, per request or per job. */
  export interface Effective {
    workspaceCreation: WorkspaceCreation
    signIn: SignIn
    limits: InstanceLimits
    smtp?: Smtp
    slack?: Slack
    /** Every provider (environment first); `signIn.sso` says whether they are offered. */
    sso: Sso[]
  }

  export type Source = 'env' | 'stored' | 'default'

  export interface Field<T> {
    value: T
    source: Source
    /** The variable that locks it; null unless `source` is `env`. */
    env: string | null
  }

  /** Never carries a secret: only whether one is saved. */
  export interface Described {
    workspaceCreation: Field<WorkspaceCreation>
    signIn: { password: Field<boolean>; email: Field<boolean>; sso: Field<boolean> }
    limits: { [K in InstanceLimitKey]: Field<number> }
    smtp: {
      source: 'env' | 'stored' | 'none'
      env: string | null
      host: string
      port: number
      secure: boolean
      user: string
      from: string
      passwordSaved: boolean
      /** Set when the saved password can't be read with the current secret. */
      unreadable: string | null
    }
    slack: {
      source: 'env' | 'stored' | 'none'
      env: string | null
      clientId: string
      secretSaved: boolean
      unreadable: string | null
    }
    sso: {
      id: Sso['id']
      name: string
      clientId: string
      issuer: string | null
      trustedForEmail: boolean
      secretSaved: boolean
      unreadable: string | null
      source: 'env' | 'stored'
      /** `AUTH_<PROVIDER>_*` for an environment provider. */
      env: string | null
    }[]
  }
}

export const emptyStored = (): InstanceConfig.Stored => ({
  signIn: {},
  limits: {},
  sso: [],
  unreadable: { smtp: false, slack: false, sso: {} },
})

/** What the admin page says about a saved secret that can't be opened. */
export const UNREADABLE_NOTICE = "Saved, but can't be read with the current secret: replace it"

export const ssoEnvName = (id: InstanceConfig.Sso['id']) => `AUTH_${id.toUpperCase()}_*`

/** The settings with every layer applied, and the same settings described for the admin page. */
export function resolve(
  env: InstanceConfig.Env,
  stored: InstanceConfig.Stored,
): { effective: InstanceConfig.Effective; described: InstanceConfig.Described } {
  const locked = (key: InstanceLockKey) => env.locked.includes(key)

  function field<T>(
    key: InstanceLockKey | undefined,
    fromEnv: T,
    fromStored: T | undefined,
    fallback: T,
  ): InstanceConfig.Field<T> {
    if (key !== undefined && locked(key)) {
      return { value: fromEnv, source: 'env', env: INSTANCE_ENV[key] }
    }
    if (fromStored !== undefined) return { value: fromStored, source: 'stored', env: null }
    return { value: fallback, source: 'default', env: null }
  }

  const limit = (k: InstanceLimitKey) =>
    field(
      k === 'defaultProjectRetentionDays' ? undefined : k,
      env.limits[k],
      stored.limits[k],
      INSTANCE_LIMIT_DEFAULTS[k],
    )
  const limits: InstanceConfig.Described['limits'] = {
    defaultProjectRetentionDays: limit('defaultProjectRetentionDays'),
    gcGraceHours: limit('gcGraceHours'),
    uploadTimeoutMinutes: limit('uploadTimeoutMinutes'),
    jobRetentionDays: limit('jobRetentionDays'),
    staticSitesMaxMb: limit('staticSitesMaxMb'),
    webhookTimeoutSeconds: limit('webhookTimeoutSeconds'),
  }

  const workspaceCreation = field<WorkspaceCreation>(
    'workspaceCreation',
    env.workspaceCreation,
    stored.workspaceCreation,
    'admin',
  )
  const signIn = {
    password: field('signInPassword', env.signIn.password, stored.signIn.password, true),
    email: field('signInEmail', env.signIn.email, stored.signIn.email, true),
    sso: field('signInSso', env.signIn.sso, stored.signIn.sso, true),
  }

  const smtpFromEnv = locked('smtp') && env.smtp !== undefined
  const smtp = smtpFromEnv ? env.smtp : stored.smtp
  const smtpUnreadable = !smtpFromEnv && stored.smtp !== undefined && stored.unreadable.smtp
  const slackFromEnv = locked('slack') && env.slack !== undefined
  const slack = slackFromEnv ? env.slack : stored.slack
  const slackUnreadable = !slackFromEnv && stored.slack !== undefined && stored.unreadable.slack
  const envIds = new Set(env.sso.map((p) => p.id))
  const ssoAll = [...env.sso, ...stored.sso.filter((p) => !envIds.has(p.id))]
  const ssoUnreadable = (p: InstanceConfig.Sso) =>
    !envIds.has(p.id) && stored.unreadable.sso[p.id] !== undefined
  // A group whose secret can't be opened is shown but never used.
  const smtpUsable = smtpUnreadable ? undefined : smtp
  const slackUsable = slackUnreadable ? undefined : slack

  const effective: InstanceConfig.Effective = {
    workspaceCreation: workspaceCreation.value,
    signIn: { password: signIn.password.value, email: signIn.email.value, sso: signIn.sso.value },
    limits: {
      defaultProjectRetentionDays: limits.defaultProjectRetentionDays.value,
      gcGraceHours: limits.gcGraceHours.value,
      uploadTimeoutMinutes: limits.uploadTimeoutMinutes.value,
      jobRetentionDays: limits.jobRetentionDays.value,
      staticSitesMaxMb: limits.staticSitesMaxMb.value,
      webhookTimeoutSeconds: limits.webhookTimeoutSeconds.value,
    },
    ...(smtpUsable ? { smtp: smtpUsable } : {}),
    ...(slackUsable ? { slack: slackUsable } : {}),
    sso: ssoAll.filter((p) => !ssoUnreadable(p)),
  }
  const described: InstanceConfig.Described = {
    workspaceCreation,
    signIn,
    limits,
    smtp: {
      source: smtp ? (smtpFromEnv ? 'env' : 'stored') : 'none',
      env: smtpFromEnv ? INSTANCE_ENV.smtp : null,
      host: smtp?.host ?? '',
      port: smtp?.port ?? 587,
      secure: smtp?.secure ?? false,
      user: smtp?.auth?.user ?? '',
      from: smtp?.from ?? '',
      passwordSaved: smtp?.auth?.password !== undefined,
      unreadable: smtpUnreadable ? UNREADABLE_NOTICE : null,
    },
    slack: {
      source: slack ? (slackFromEnv ? 'env' : 'stored') : 'none',
      env: slackFromEnv ? INSTANCE_ENV.slack : null,
      clientId: slack?.clientId ?? '',
      secretSaved: slack !== undefined,
      unreadable: slackUnreadable ? UNREADABLE_NOTICE : null,
    },
    sso: ssoAll.map((p) => {
      const fromEnv = envIds.has(p.id)
      return {
        id: p.id,
        name: p.name,
        clientId: p.clientId,
        issuer: p.issuer ?? null,
        trustedForEmail: p.trustedForEmail,
        secretSaved: p.clientSecret !== '' || ssoUnreadable(p),
        unreadable: ssoUnreadable(p) ? UNREADABLE_NOTICE : null,
        source: fromEnv ? ('env' as const) : ('stored' as const),
        env: fromEnv ? ssoEnvName(p.id) : null,
      }
    }),
  }
  return { effective, described }
}

/** Which sign-in methods work with this configuration. */
export function availability(effective: InstanceConfig.Effective): SignInAvailability {
  return {
    password: effective.signIn.password,
    email: effective.signIn.email,
    mailConfigured: effective.smtp !== undefined,
    sso: effective.signIn.sso,
    ssoProviders: effective.sso.length,
  }
}

/** The providers that are offered: none when single sign-on is switched off. */
export const activeSso = (effective: InstanceConfig.Effective): InstanceConfig.Sso[] =>
  effective.signIn.sso ? effective.sso : []

/** Email codes are offered: switched on and mail can be sent. */
export const emailLoginOffered = (effective: InstanceConfig.Effective): boolean =>
  effective.signIn.email && effective.smtp !== undefined
