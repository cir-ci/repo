import type { InstanceAdmin } from '@circi/api'
import {
  INSTANCE_LIMIT_BOUNDS,
  type InstanceLimitKey,
  limitProblem,
  smtpProblems,
} from '@circi/core'

/**
 * The page's draft of the instance settings (Instance › Settings) and what a save sends. Pure
 * logic, so it is tested in Node. Settings whose environment variable is set are locked: they
 * are never part of a change.
 */

/** A write-only secret: left as saved, replaced by a new one, or removed. */
export type SecretDraft = { mode: 'keep' } | { mode: 'replace'; value: string } | { mode: 'remove' }

export interface ConfigDraft {
  /** Every signed-in account may create workspaces (otherwise instance admins only). */
  anyoneCreatesWorkspaces: boolean
  signIn: { password: boolean; email: boolean; sso: boolean }
  limits: { [K in InstanceLimitKey]: number | null }
  smtp: {
    host: string
    port: number | null
    secure: boolean
    user: string
    from: string
    password: SecretDraft
  }
  slack: { clientId: string; secret: SecretDraft }
}

export const LIMIT_KEYS: InstanceLimitKey[] = [
  'defaultProjectRetentionDays',
  'gcGraceHours',
  'uploadTimeoutMinutes',
  'jobRetentionDays',
  'staticSitesMaxMb',
  'webhookTimeoutSeconds',
]

export function draftOf(config: InstanceAdmin.Config): ConfigDraft {
  return {
    anyoneCreatesWorkspaces: config.workspaceCreation.value === 'anyone',
    signIn: {
      password: config.signIn.password.value,
      email: config.signIn.email.value,
      sso: config.signIn.sso.value,
    },
    limits: {
      defaultProjectRetentionDays: config.limits.defaultProjectRetentionDays.value,
      gcGraceHours: config.limits.gcGraceHours.value,
      uploadTimeoutMinutes: config.limits.uploadTimeoutMinutes.value,
      jobRetentionDays: config.limits.jobRetentionDays.value,
      staticSitesMaxMb: config.limits.staticSitesMaxMb.value,
      webhookTimeoutSeconds: config.limits.webhookTimeoutSeconds.value,
    },
    smtp: {
      host: config.smtp.host,
      port: config.smtp.source === 'none' ? 587 : config.smtp.port,
      secure: config.smtp.secure,
      user: config.smtp.user,
      from: config.smtp.from,
      password: { mode: 'keep' },
    },
    slack: { clientId: config.slack.clientId, secret: { mode: 'keep' } },
  }
}

/** The mail server is edited here (not set by `SMTP_*`, and something is filled in or saved). */
const editsSmtp = (config: InstanceAdmin.Config) => config.smtp.source !== 'env'
const editsSlack = (config: InstanceAdmin.Config) => config.slack.source !== 'env'

const sameSecret = (a: SecretDraft, b: SecretDraft) =>
  a.mode === b.mode && (a.mode !== 'replace' || (b.mode === 'replace' && a.value === b.value))

function smtpChanged(saved: ConfigDraft['smtp'], draft: ConfigDraft['smtp']): boolean {
  return (
    saved.host !== draft.host ||
    saved.port !== draft.port ||
    saved.secure !== draft.secure ||
    saved.user !== draft.user ||
    saved.from !== draft.from ||
    !sameSecret(saved.password, draft.password)
  )
}

/** Whether the draft differs from what is saved, in anything the page can change. */
export function isDirty(config: InstanceAdmin.Config, draft: ConfigDraft): boolean {
  return saveRequests(config, draft).length > 0
}

export type ConfigProblems = Record<string, string>

/** What is wrong, by field path (`limits.gcGraceHours`, `smtp.host`, `slack.clientId`); empty when it can be saved. */
export function configProblems(config: InstanceAdmin.Config, draft: ConfigDraft): ConfigProblems {
  const problems: ConfigProblems = {}
  for (const key of LIMIT_KEYS) {
    const locked = config.limits[key].source === 'env'
    const value = draft.limits[key]
    if (!locked && value !== config.limits[key].value) {
      const problem = limitProblem(key, value)
      if (problem) problems[`limits.${key}`] = problem
    }
  }
  const saved = draftOf(config)
  if (editsSmtp(config) && smtpChanged(saved.smtp, draft.smtp)) {
    const found = smtpProblems(
      {
        host: draft.smtp.host,
        port: draft.smtp.port ?? Number.NaN,
        secure: draft.smtp.secure,
        user: draft.smtp.user,
        from: draft.smtp.from,
      },
      draft.smtp.password.mode === 'replace' ||
        (draft.smtp.password.mode === 'keep' && config.smtp.passwordSaved),
    )
    for (const [field, message] of Object.entries(found)) problems[`smtp.${field}`] = message
    const hasPassword =
      draft.smtp.password.mode === 'replace' ||
      (draft.smtp.password.mode === 'keep' && config.smtp.passwordSaved)
    if (draft.smtp.user.trim() !== '' && !hasPassword) {
      problems['smtp.password'] = 'Enter the password that goes with the user name'
    }
    // The server refuses a save that keeps a password it can't read.
    if (draft.smtp.password.mode === 'keep' && config.smtp.unreadable) {
      problems['smtp.password'] = "Enter the password: the saved one can't be read"
    }
    if (draft.smtp.password.mode === 'replace' && draft.smtp.password.value === '') {
      problems['smtp.password'] = 'Enter the password'
    }
  }
  if (editsSlack(config) && slackChanged(saved.slack, draft.slack)) {
    if (!draft.slack.clientId.trim()) problems['slack.clientId'] = 'Enter the client ID'
    const hasSecret =
      draft.slack.secret.mode === 'replace' ||
      (draft.slack.secret.mode === 'keep' && config.slack.secretSaved)
    if (!hasSecret || (draft.slack.secret.mode === 'replace' && draft.slack.secret.value === '')) {
      problems['slack.secret'] = 'Enter the client secret'
    }
  }
  return problems
}

function slackChanged(saved: ConfigDraft['slack'], draft: ConfigDraft['slack']): boolean {
  return saved.clientId !== draft.clientId || !sameSecret(saved.secret, draft.secret)
}

/** One request of a save. The mail server goes first: email codes need it. */
export interface SaveRequest {
  method: 'PUT'
  path: string[]
  body: unknown
}

/** The requests that bring what is saved to the draft; nothing for what is unchanged or locked. */
export function saveRequests(config: InstanceAdmin.Config, draft: ConfigDraft): SaveRequest[] {
  const saved = draftOf(config)
  const requests: SaveRequest[] = []

  if (editsSmtp(config) && smtpChanged(saved.smtp, draft.smtp)) {
    const password =
      draft.smtp.password.mode === 'replace'
        ? { password: draft.smtp.password.value }
        : draft.smtp.password.mode === 'remove'
          ? { password: null }
          : {}
    requests.push({
      method: 'PUT',
      path: ['config', 'smtp'],
      body: {
        host: draft.smtp.host.trim(),
        port: draft.smtp.port,
        secure: draft.smtp.secure,
        user: draft.smtp.user.trim(),
        from: draft.smtp.from.trim(),
        ...password,
      },
    })
  }

  if (editsSlack(config) && slackChanged(saved.slack, draft.slack)) {
    requests.push({
      method: 'PUT',
      path: ['config', 'slack'],
      body: {
        clientId: draft.slack.clientId.trim(),
        ...(draft.slack.secret.mode === 'replace'
          ? { clientSecret: draft.slack.secret.value }
          : {}),
      },
    })
  }

  if (
    config.workspaceCreation.source !== 'env' &&
    saved.anyoneCreatesWorkspaces !== draft.anyoneCreatesWorkspaces
  ) {
    requests.push({
      method: 'PUT',
      path: ['config', 'workspace-creation'],
      body: { value: draft.anyoneCreatesWorkspaces ? 'anyone' : 'admin' },
    })
  }

  const limits: Partial<Record<InstanceLimitKey, number>> = {}
  for (const key of LIMIT_KEYS) {
    const value = draft.limits[key]
    if (config.limits[key].source !== 'env' && value !== null && value !== saved.limits[key]) {
      limits[key] = value
    }
  }
  if (Object.keys(limits).length > 0) {
    requests.push({ method: 'PUT', path: ['config', 'limits'], body: limits })
  }

  const signIn: Partial<ConfigDraft['signIn']> = {}
  for (const key of ['password', 'email', 'sso'] as const) {
    if (config.signIn[key].source !== 'env' && saved.signIn[key] !== draft.signIn[key]) {
      signIn[key] = draft.signIn[key]
    }
  }
  if (Object.keys(signIn).length > 0) {
    requests.push({ method: 'PUT', path: ['config', 'sign-in'], body: signIn })
  }
  return requests
}

/**
 * Whether nobody could sign in once the draft is saved: password and email code are off, and
 * single sign-on is off or has no provider to sign in with.
 */
export function noSignInLeft(config: InstanceAdmin.Config, draft: ConfigDraft): boolean {
  const { password, email, sso } = draft.signIn
  return !password && !email && !(sso && config.sso.length > 0)
}

/** The smallest and largest value a limit accepts, for the field. */
export const limitBounds = (key: InstanceLimitKey) => INSTANCE_LIMIT_BOUNDS[key]

/** "Set by GC_GRACE_HOURS" for a locked setting; undefined otherwise. */
export const lockedBy = (field: { env: string | null }): string | undefined =>
  field.env ? `Set by ${field.env}` : undefined

/** The mail server in a line: "smtp.acme.io:587 (TLS)". */
export function mailServer(smtp: InstanceAdmin.Config['smtp']): string | null {
  if (smtp.source === 'none' || !smtp.host) return null
  return `${smtp.host}:${smtp.port}${smtp.secure ? ' (TLS)' : ''}`
}

/** What a provider is called when it has no name of its own. */
export const PROVIDER_LABELS: Record<InstanceAdmin.SsoProvider['id'], string> = {
  github: 'GitHub',
  gitlab: 'GitLab',
  google: 'Google',
  oidc: 'OpenID Connect',
}

/** The callback address to register at the identity provider. */
export const callbackAddress = (origin: string, id: InstanceAdmin.SsoProvider['id']) =>
  `${origin}/api/auth/callback/${id}`
