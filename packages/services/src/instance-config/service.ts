import {
  ConflictError,
  INSTANCE_ENV,
  INSTANCE_LIMIT_KEYS,
  type InstanceLimits,
  type InstanceLockKey,
  limitProblem,
  type SignInMethodKind,
  signInLockout,
  smtpProblems,
  ValidationError,
  type WorkspaceCreation,
  workingSignInMethods,
} from '@circi/core'
import type { Database } from '@circi/db'

import { availability, emptyStored, type InstanceConfig, resolve, ssoEnvName } from './model.ts'
import { readStored, writeStored } from './store.ts'

/** How long a replica trusts what it last read before it reads the settings again. */
export const INSTANCE_CONFIG_TTL_MS = 30_000

/** Who is changing the settings: the kind of sign-in they are using right now, if it is known. */
export interface InstanceConfigActor {
  using?: SignInMethodKind
}

export namespace createInstanceConfig {
  export interface Options {
    db: Database
    /** The instance secret that seals the stored secrets. */
    authSecret: string
    /** What the environment says. */
    env: InstanceConfig.Env
    /** Default 30 seconds. */
    ttlMs?: number
    /** Replaceable in tests. */
    now?: () => number
  }

  export interface SmtpInput {
    host: string
    port: number
    secure: boolean
    user: string
    from: string
    /** Absent keeps the saved password, a string replaces it, null removes it. */
    password?: string | null
  }

  export interface SlackInput {
    clientId: string
    /** Absent keeps the saved secret. */
    clientSecret?: string
  }

  export interface SsoInput {
    id: InstanceConfig.Sso['id']
    name?: string
    clientId: string
    /** Absent keeps the saved secret. */
    clientSecret?: string
    issuer?: string
    trustedForEmail: boolean
  }
}

export type InstanceConfigStore = ReturnType<typeof createInstanceConfig>

const PROVIDER_NAMES: Record<InstanceConfig.Sso['id'], string> = {
  github: 'GitHub',
  gitlab: 'GitLab',
  google: 'Google',
  oidc: 'Single sign-on',
}

function lockedError(key: InstanceLockKey): ConflictError {
  return new ConflictError(`Set by ${INSTANCE_ENV[key]} in the environment: change it there.`)
}

function fail(fields: Record<string, string>): never {
  throw new ValidationError(Object.values(fields)[0] ?? 'Invalid settings', { fields })
}

const isHttpAddress = (v: string) => /^https?:\/\/\S+$/.test(v)

/**
 * The instance's settings, read per request or per job: a TTL-cached read of what the dashboard
 * saved, put under the environment's (see `resolve`). Saving writes the database and makes this
 * replica read again at once; the other replicas pick the change up when their TTL runs out, so
 * nobody restarts. A failed read keeps what was read last (or the environment's values at start).
 * Every change that can leave nobody able to sign in is refused here, with the reason.
 */
export function createInstanceConfig(options: createInstanceConfig.Options) {
  const { db, authSecret, env } = options
  const ttl = options.ttlMs ?? INSTANCE_CONFIG_TTL_MS
  const now = options.now ?? Date.now
  let readAt = Number.NEGATIVE_INFINITY
  let current = resolve(env, emptyStored())
  let signature = JSON.stringify(current.effective)
  let inflight: Promise<void> | undefined
  const listeners = new Set<(effective: InstanceConfig.Effective) => void>()

  function apply(stored: InstanceConfig.Stored) {
    current = resolve(env, stored)
    readAt = now()
    const next = JSON.stringify(current.effective)
    if (next === signature) return
    signature = next
    for (const listener of listeners) listener(current.effective)
  }

  async function read(): Promise<void> {
    try {
      apply(await readStored(db, authSecret))
    } catch {
      // A database error is not asked again on every request; the last read stays.
      readAt = now()
    }
  }

  async function fresh(): Promise<void> {
    if (now() - readAt < ttl) return
    inflight ??= read().finally(() => {
      inflight = undefined
    })
    await inflight
  }

  const isLocked = (key: InstanceLockKey) => env.locked.includes(key)

  /** The one write path: change what is stored, check, save, and read again. */
  async function change(
    update: (stored: InstanceConfig.Stored) => void,
    check?: { actor?: InstanceConfigActor },
  ): Promise<InstanceConfig.Described> {
    const stored = await readStored(db, authSecret)
    const before = resolve(env, stored).effective
    update(stored)
    const after = resolve(env, stored).effective
    if (check) {
      const using = check.actor?.using
      const was = workingSignInMethods(availability(before))
      const working = workingSignInMethods(availability(after))
      const refusal = signInLockout(
        availability(after),
        using !== undefined && was.includes(using) ? using : undefined,
      )
      if (refusal && (working.length === 0 || was.length > 0)) {
        throw new ConflictError(refusal)
      }
    }
    await writeStored(db, authSecret, stored)
    apply(stored)
    return current.described
  }

  return {
    /** The settings with every layer applied. */
    async get(): Promise<InstanceConfig.Effective> {
      await fresh()
      return current.effective
    },
    /** The same, described for the admin page: sources, locks, and no secret. */
    async describe(): Promise<InstanceConfig.Described> {
      await fresh()
      return current.described
    },
    /** Makes the next read go to the database. */
    invalidate() {
      readAt = Number.NEGATIVE_INFINITY
    },
    /** Called with the new settings whenever they change, here or (after a TTL) from another replica. */
    subscribe(listener: (effective: InstanceConfig.Effective) => void): () => void {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },

    async setWorkspaceCreation(value: WorkspaceCreation) {
      if (value !== 'admin' && value !== 'anyone') {
        fail({ workspaceCreation: 'Choose instance admins or anyone' })
      }
      if (isLocked('workspaceCreation')) throw lockedError('workspaceCreation')
      return change((stored) => {
        stored.workspaceCreation = value
      })
    },

    async setSignIn(input: Partial<InstanceConfig.SignIn>, actor?: InstanceConfigActor) {
      const keys = { password: 'signInPassword', email: 'signInEmail', sso: 'signInSso' } as const
      for (const key of ['password', 'email', 'sso'] as const) {
        if (input[key] !== undefined && isLocked(keys[key])) throw lockedError(keys[key])
      }
      return change(
        (stored) => {
          Object.assign(stored.signIn, input)
        },
        actor ? { actor } : {},
      )
    },

    async setLimits(input: Partial<InstanceLimits>) {
      const problems: Record<string, string> = {}
      for (const key of INSTANCE_LIMIT_KEYS) {
        const value = input[key]
        if (value === undefined) continue
        const problem = limitProblem(key, value)
        if (problem) problems[key] = problem
        else if (key !== 'defaultProjectRetentionDays' && isLocked(key)) {
          problems[key] = `Set by ${INSTANCE_ENV[key]} in the environment: change it there.`
        }
      }
      if (Object.keys(problems).length > 0) fail(problems)
      return change((stored) => {
        Object.assign(stored.limits, input)
      })
    },

    async saveSmtp(input: createInstanceConfig.SmtpInput, actor?: InstanceConfigActor) {
      if (isLocked('smtp')) throw lockedError('smtp')
      return change(
        (stored) => {
          const saved = stored.smtp?.auth?.password
          const password = input.password === undefined ? saved : (input.password ?? undefined)
          const fields = { ...input, host: input.host.trim(), from: input.from.trim() }
          const problems: Record<string, string> = smtpProblems(fields, password !== undefined)
          if (fields.user.trim() !== '' && password === undefined) {
            problems.password = 'Enter the password that goes with the user name'
          }
          if (Object.keys(problems).length > 0) fail(problems)
          const user = fields.user.trim()
          stored.smtp = {
            host: fields.host,
            port: fields.port,
            secure: fields.secure,
            from: fields.from,
            ...(user && password !== undefined ? { auth: { user, password } } : {}),
          }
        },
        actor ? { actor } : {},
      )
    },

    async removeSmtp(actor?: InstanceConfigActor) {
      if (isLocked('smtp')) throw lockedError('smtp')
      return change(
        (stored) => {
          delete stored.smtp
        },
        actor ? { actor } : {},
      )
    },

    async saveSlack(input: createInstanceConfig.SlackInput) {
      if (isLocked('slack')) throw lockedError('slack')
      return change((stored) => {
        const clientId = input.clientId.trim()
        const clientSecret = input.clientSecret?.trim() || stored.slack?.clientSecret
        const problems: Record<string, string> = {}
        if (!clientId) problems.clientId = 'Enter the client ID'
        if (!clientSecret) problems.clientSecret = 'Enter the client secret'
        if (Object.keys(problems).length > 0 || !clientSecret) fail(problems)
        stored.slack = { clientId, clientSecret }
      })
    },

    async removeSlack() {
      if (isLocked('slack')) throw lockedError('slack')
      return change((stored) => {
        delete stored.slack
      })
    },

    async saveSso(input: createInstanceConfig.SsoInput, actor?: InstanceConfigActor) {
      if (env.sso.some((p) => p.id === input.id)) {
        throw new ConflictError(
          `Set by ${ssoEnvName(input.id)} in the environment: change it there.`,
        )
      }
      return change(
        (stored) => {
          const existing = stored.sso.find((p) => p.id === input.id)
          const clientId = input.clientId.trim()
          const clientSecret = input.clientSecret?.trim() || existing?.clientSecret
          const issuer = input.issuer?.trim() || undefined
          const problems: Record<string, string> = {}
          if (!clientId) problems.clientId = 'Enter the client ID'
          if (!clientSecret) problems.clientSecret = 'Enter the client secret'
          if (input.id === 'oidc' && !(issuer && isHttpAddress(issuer))) {
            problems.issuer = 'Enter the issuer address, like https://login.acme.io'
          }
          if (input.id === 'gitlab' && issuer && !isHttpAddress(issuer)) {
            problems.issuer = 'Enter an http(s) address'
          }
          if (Object.keys(problems).length > 0 || !clientSecret) fail(problems)
          const name = input.name?.trim() || PROVIDER_NAMES[input.id]
          if (name.length > 60) fail({ name: 'Use at most 60 characters' })
          const next: InstanceConfig.Sso = {
            id: input.id,
            name,
            clientId,
            clientSecret,
            ...((input.id === 'oidc' || input.id === 'gitlab') && issuer
              ? { issuer: issuer.replace(/\/$/, '') }
              : {}),
            // Only an OpenID Connect provider's trust is the operator's to vouch for.
            trustedForEmail: input.id === 'oidc' ? input.trustedForEmail : input.id !== 'gitlab',
          }
          stored.sso = [...stored.sso.filter((p) => p.id !== input.id), next]
        },
        actor ? { actor } : {},
      )
    },

    async removeSso(id: InstanceConfig.Sso['id'], actor?: InstanceConfigActor) {
      if (env.sso.some((p) => p.id === id)) {
        throw new ConflictError(`Set by ${ssoEnvName(id)} in the environment: change it there.`)
      }
      return change(
        (stored) => {
          stored.sso = stored.sso.filter((p) => p.id !== id)
        },
        actor ? { actor } : {},
      )
    },
  }
}
