import { and, eq, sql, type SQL } from 'drizzle-orm'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'

import {
  account,
  type LoginMethod,
  member,
  workspaceAuthSettings,
  workspaceDeletions,
  workspace,
  sessionMethods,
} from '#schema/index.ts'
import type { Database } from '#src/client.ts'
import { ConflictError } from '#src/errors.ts'

/**
 * Login methods per workspace (PLAN §7.8). The instance switches are the outer limit;
 * a workspace can only narrow them. The method a session signed in with is remembered, and
 * a workspace's content is only shown to sessions whose method it accepts.
 */

export type { LoginMethod }

export namespace SessionMethod {
  /** A session's login method, or `unknown` for sessions that predate the record. */
  /** A workspace's own single sign-on opens that workspace and nothing else. */
  export interface WorkspaceScoped {
    scopedTo: string
  }
  /** A session that signed in through GitHub or Google, which a workspace may switch off. */
  export interface Provider {
    oidcProvider: SwitchableProvider
  }
}
export type SessionMethod =
  | LoginMethod
  | 'unknown'
  | SessionMethod.WorkspaceScoped
  | SessionMethod.Provider

/** The single sign-on providers a workspace can switch off. */
export const SWITCHABLE_PROVIDERS = ['github', 'google'] as const
export type SwitchableProvider = (typeof SWITCHABLE_PROVIDERS)[number]

export const isSwitchableProvider = (
  value: string | null | undefined,
): value is SwitchableProvider => SWITCHABLE_PROVIDERS.some((p) => p === value)

/** How a provider is named in messages. */
export const PROVIDER_LABEL: Record<SwitchableProvider, string> = {
  github: 'GitHub',
  google: 'Google',
}

export namespace getWorkspaceAuthSettings {
  /** What the instance offers; the caller derives it from config. */
  export interface Instance {
    password: boolean
    email: boolean
    /** GitHub and Google sign-in are configured. */
    github: boolean
    google: boolean
    /** Any other provider (generic OpenID Connect, GitLab) is configured. */
    oidc: boolean
  }

  export interface Result {
    emailLoginEnabled: boolean
    passwordLoginEnabled: boolean
    signinGithub: boolean
    signinGoogle: boolean
  }
}

/** What the instance offers, from its config: the provider ids that are set up (`github`, `google`, `oidc`…). */
export function instanceAuthMethods(input: {
  password: boolean
  email: boolean
  providers: readonly string[]
}): getWorkspaceAuthSettings.Instance {
  return {
    password: input.password,
    email: input.email,
    github: input.providers.includes('github'),
    google: input.providers.includes('google'),
    oidc: input.providers.some((p) => p !== 'github' && p !== 'google'),
  }
}

const DEFAULTS: getWorkspaceAuthSettings.Result = {
  emailLoginEnabled: true,
  passwordLoginEnabled: true,
  signinGithub: true,
  signinGoogle: true,
}

export async function getWorkspaceAuthSettings(
  db: Database,
  workspaceId: string,
): Promise<getWorkspaceAuthSettings.Result> {
  const [row] = await db
    .select()
    .from(workspaceAuthSettings)
    .where(eq(workspaceAuthSettings.workspaceId, workspaceId))
  return row
    ? {
        emailLoginEnabled: row.emailLoginEnabled,
        passwordLoginEnabled: row.passwordLoginEnabled,
        signinGithub: row.signinGithub,
        signinGoogle: row.signinGoogle,
      }
    : DEFAULTS
}

export async function recordSessionMethod(
  db: Database,
  sessionId: string,
  method: LoginMethod,
  scopeWorkspaceId?: string,
  provider?: string,
): Promise<void> {
  const scope = method === 'workspace-oidc' ? (scopeWorkspaceId ?? null) : null
  const via = method === 'oidc' ? (provider ?? null) : null
  await db
    .insert(sessionMethods)
    .values({ sessionId, method, scopeWorkspaceId: scope, provider: via })
    .onConflictDoUpdate({
      target: sessionMethods.sessionId,
      set: { method, scopeWorkspaceId: scope, provider: via },
    })
}

/** How a session signed in; `undefined` for sessions that predate the record. */
export async function getSessionMethod(
  db: Database,
  sessionId: string,
): Promise<SessionMethod | undefined> {
  const [row] = await db
    .select({
      method: sessionMethods.method,
      scope: sessionMethods.scopeWorkspaceId,
      provider: sessionMethods.provider,
    })
    .from(sessionMethods)
    .where(eq(sessionMethods.sessionId, sessionId))
  const method = row?.method
  if (method === 'workspace-oidc') return row?.scope ? { scopedTo: row.scope } : undefined
  // A session from before the provider was recorded counts as plain single sign-on.
  if (method === 'oidc' && isSwitchableProvider(row?.provider)) {
    return { oidcProvider: row.provider }
  }
  return method === 'password' || method === 'email' || method === 'oidc' ? method : undefined
}

/** SQL: the workspace in `workspaceId` has not been deleted. */
export function workspaceIsLive(workspaceId: AnyPgColumn): SQL {
  return sql`not exists (select 1 from ${workspaceDeletions} where ${workspaceDeletions.workspaceId} = ${workspaceId})`
}

/**
 * SQL: the workspace's login-method switches accept a session that signed in with `method`.
 * Single sign-on is accepted unless the session came through GitHub or Google and the workspace
 * switched that off; a session of unknown method only where nothing is restricted. `undefined`
 * (not a dashboard session, e.g. the CLI) applies no restriction.
 */
export function methodAccepted(workspaceId: AnyPgColumn, method: SessionMethod | undefined): SQL {
  if (method === undefined || method === 'oidc') return sql`true`
  if (typeof method === 'object') {
    if ('scopedTo' in method) return sql`${workspaceId} = ${method.scopedTo}`
    const off =
      method.oidcProvider === 'github'
        ? sql`${workspaceAuthSettings.signinGithub} = false`
        : sql`${workspaceAuthSettings.signinGoogle} = false`
    return sql`not exists (select 1 from ${workspaceAuthSettings} where ${workspaceAuthSettings.workspaceId} = ${workspaceId} and ${off})`
  }
  const restricted =
    method === 'password'
      ? sql`${workspaceAuthSettings.passwordLoginEnabled} = false`
      : method === 'email'
        ? sql`${workspaceAuthSettings.emailLoginEnabled} = false`
        : sql`(${workspaceAuthSettings.passwordLoginEnabled} = false or ${workspaceAuthSettings.emailLoginEnabled} = false or ${workspaceAuthSettings.signinGithub} = false or ${workspaceAuthSettings.signinGoogle} = false)`
  return sql`not exists (select 1 from ${workspaceAuthSettings} where ${workspaceAuthSettings.workspaceId} = ${workspaceId} and ${restricted})`
}

/**
 * SQL: a member's session may open the workspace: it is not deleted (a deleted workspace is
 * invisible to everyone, whatever the method) and its switches accept the session's method.
 */
export function workspaceAccepts(workspaceId: AnyPgColumn, method: SessionMethod | undefined): SQL {
  return sql`(${workspaceIsLive(workspaceId)} and ${methodAccepted(workspaceId, method)})`
}

/** Whether the workspace accepts a session that signed in with `method`. */
export async function workspaceAcceptsSession(
  db: Database,
  workspaceId: string,
  method: SessionMethod | undefined,
): Promise<boolean> {
  const [row] = await db
    .select({ id: workspace.id })
    .from(workspace)
    .where(and(eq(workspace.id, workspaceId), workspaceAccepts(workspace.id, method)))
  return row !== undefined
}

/**
 * When a member's session is refused only because the workspace switched off the single
 * sign-on provider it came through: the message to show (a 403, not a "not found", since they
 * are members and the reason helps). Undefined for any other session or reason.
 */
export async function providerRefusal(
  db: Database,
  input: { workspaceId: string; method: SessionMethod | undefined },
): Promise<string | undefined> {
  const { method } = input
  if (typeof method !== 'object' || !('oidcProvider' in method)) return undefined
  if (!(await workspaceAcceptsSession(db, input.workspaceId, method))) {
    return `This workspace doesn't allow sign-in with ${PROVIDER_LABEL[method.oidcProvider]}`
  }
  return undefined
}

/** Workspaces the user belongs to but whose rules refuse this session's login method. */
export async function listRefusingWorkspaces(
  db: Database,
  userId: string,
  method: SessionMethod,
  /** The single sign-on providers the instance has set up: only those are offered as ways in. */
  providers: readonly string[] = [],
): Promise<{ name: string; accepts: ('password' | 'email' | 'github' | 'google')[] }[]> {
  const rows = await db
    .select({
      name: workspace.name,
      email: workspaceAuthSettings.emailLoginEnabled,
      password: workspaceAuthSettings.passwordLoginEnabled,
      github: workspaceAuthSettings.signinGithub,
      google: workspaceAuthSettings.signinGoogle,
    })
    .from(member)
    .innerJoin(workspace, eq(workspace.id, member.workspaceId))
    .innerJoin(workspaceAuthSettings, eq(workspaceAuthSettings.workspaceId, workspace.id))
    .where(
      and(
        eq(member.userId, userId),
        workspaceIsLive(workspace.id),
        sql`not (${methodAccepted(workspace.id, method)})`,
      ),
    )
  return rows.map((r) => ({
    name: r.name,
    accepts: [
      ...(r.password ? (['password'] as const) : []),
      ...(r.email ? (['email'] as const) : []),
      ...(r.github && providers.includes('github') ? (['github'] as const) : []),
      ...(r.google && providers.includes('google') ? (['google'] as const) : []),
    ],
  }))
}

/** Whether any owner of the workspace could still sign in, given which methods are on. */
async function ownerCanSignIn(
  db: Database,
  workspaceId: string,
  on: { password: boolean; email: boolean; github: boolean; google: boolean; oidc: boolean },
): Promise<boolean> {
  if (on.email) return true // any account can ask for a code
  const owners = await db
    .select({ userId: member.userId })
    .from(member)
    .where(and(eq(member.workspaceId, workspaceId), eq(member.role, 'owner')))
  for (const owner of owners) {
    // eslint-disable-next-line no-await-in-loop -- a handful of owners
    const accounts = await db
      .select({ provider: account.providerId })
      .from(account)
      .where(eq(account.userId, owner.userId))
    const usable = accounts.some((a) => {
      if (a.provider === 'credential') return on.password
      if (a.provider === 'github') return on.github
      if (a.provider === 'google') return on.google
      return on.oidc
    })
    if (usable) return true
  }
  return false
}

/**
 * Saves a workspace's switches. Refused when it would leave no owner able to sign in with
 * any method that's on (the lockout guard); `force` skips that, for the break-glass CLI.
 */
export async function setWorkspaceAuthSettings(
  db: Database,
  workspaceId: string,
  patch: Partial<getWorkspaceAuthSettings.Result>,
  options: { instance: getWorkspaceAuthSettings.Instance; force?: boolean },
): Promise<getWorkspaceAuthSettings.Result> {
  const next = { ...(await getWorkspaceAuthSettings(db, workspaceId)), ...patch }
  if (!options.force) {
    const on = {
      password: options.instance.password && next.passwordLoginEnabled,
      email: options.instance.email && next.emailLoginEnabled,
      github: options.instance.github && next.signinGithub,
      google: options.instance.google && next.signinGoogle,
      oidc: options.instance.oidc,
    }
    if (!(await ownerCanSignIn(db, workspaceId, on))) {
      throw new ConflictError(
        'That would leave no owner able to sign in. Keep a method on that an owner can use.',
      )
    }
  }
  await db
    .insert(workspaceAuthSettings)
    .values({ workspaceId, ...next })
    .onConflictDoUpdate({
      target: workspaceAuthSettings.workspaceId,
      set: { ...next, updatedAt: new Date() },
    })
  return next
}
