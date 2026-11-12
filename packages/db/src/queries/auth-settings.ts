import { and, eq, gt, sql } from 'drizzle-orm'

import {
  member,
  session,
  sessionMethods,
  ssoProvider,
  user,
  workspace,
  workspaceAuthSettings,
} from '#schema/index.ts'
import {
  methodAccepted,
  type SessionMethod,
  SWITCHABLE_PROVIDERS,
  type SwitchableProvider,
  workspaceAccepts,
  workspaceIsLive,
} from '#shared/session-method.ts'
import type { Database } from '#src/client.ts'

/** What a workspace's login-method switches say, and which sessions they let in (PLAN §7.8). */

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

interface MethodRow {
  method: string | null | undefined
  scope: string | null | undefined
  provider: string | null | undefined
}

function toSessionMethod(row: MethodRow | undefined): SessionMethod | undefined {
  const method = row?.method
  if (method === 'workspace-oidc') return row?.scope ? { scopedTo: row.scope } : undefined
  // A session from before the provider was recorded counts as plain single sign-on.
  if (method === 'oidc' && isSwitchableProvider(row?.provider)) {
    return { oidcProvider: row.provider }
  }
  return method === 'password' || method === 'email' || method === 'oidc' ? method : undefined
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
  return toSessionMethod(row)
}

/**
 * What a dashboard request needs to know about its session, in one query: that the session still
 * exists and has not expired (so signing out, revoking or banning ends it at once even while
 * better-auth's cookie cache still vouches for it), how it signed in (`getSessionMethod`; a
 * session from before the record is `'unknown'`) and whether the user is an instance admin.
 * Instance admins are never locked out by a workspace's GitHub or Google switch, so for them such
 * a session counts as plain single sign-on. `undefined` when the session is gone.
 */
export async function getSessionAccess(
  db: Database,
  input: { sessionId: string; userId: string },
): Promise<{ method: SessionMethod; instanceAdmin: boolean } | undefined> {
  const [row] = await db
    .select({
      method: sessionMethods.method,
      scope: sessionMethods.scopeWorkspaceId,
      provider: sessionMethods.provider,
      role: user.role,
    })
    .from(session)
    .innerJoin(user, eq(user.id, session.userId))
    .leftJoin(sessionMethods, eq(sessionMethods.sessionId, session.id))
    .where(
      and(
        eq(session.id, input.sessionId),
        eq(session.userId, input.userId),
        gt(session.expiresAt, new Date()),
      ),
    )
  if (!row) return undefined
  const instanceAdmin = (row.role ?? '').split(',').includes('admin')
  let method: SessionMethod = toSessionMethod(row) ?? 'unknown'
  if (typeof method === 'object' && 'oidcProvider' in method && instanceAdmin) method = 'oidc'
  return { method, instanceAdmin }
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

/**
 * Whether any workspace has its own identity provider set up: the sign-in page offers
 * "Continue with SSO" (which asks for the workspace) only then.
 */
export async function hasWorkspaceSso(db: Database): Promise<boolean> {
  const [row] = await db
    .select({ one: sql<number>`1` })
    .from(ssoProvider)
    .where(sql`${ssoProvider.workspaceId} is not null`)
    .limit(1)
  return row !== undefined
}
