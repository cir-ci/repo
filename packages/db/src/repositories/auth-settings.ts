import { and, eq, sql, type SQL } from 'drizzle-orm'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'

import {
  account,
  type LoginMethod,
  member,
  workspaceAuthSettings,
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
}
export type SessionMethod = LoginMethod | 'unknown' | SessionMethod.WorkspaceScoped

export namespace getWorkspaceAuthSettings {
  /** What the instance offers; the caller derives it from config. */
  export interface Instance {
    password: boolean
    email: boolean
    oidc: boolean
  }

  export interface Result {
    emailLoginEnabled: boolean
    passwordLoginEnabled: boolean
  }
}

const DEFAULTS: getWorkspaceAuthSettings.Result = {
  emailLoginEnabled: true,
  passwordLoginEnabled: true,
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
    ? { emailLoginEnabled: row.emailLoginEnabled, passwordLoginEnabled: row.passwordLoginEnabled }
    : DEFAULTS
}

export async function recordSessionMethod(
  db: Database,
  sessionId: string,
  method: LoginMethod,
  scopeWorkspaceId?: string,
): Promise<void> {
  const scope = method === 'workspace-oidc' ? (scopeWorkspaceId ?? null) : null
  await db
    .insert(sessionMethods)
    .values({ sessionId, method, scopeWorkspaceId: scope })
    .onConflictDoUpdate({
      target: sessionMethods.sessionId,
      set: { method, scopeWorkspaceId: scope },
    })
}

/** How a session signed in; `undefined` for sessions that predate the record. */
export async function getSessionMethod(
  db: Database,
  sessionId: string,
): Promise<SessionMethod | undefined> {
  const [row] = await db
    .select({ method: sessionMethods.method, scope: sessionMethods.scopeWorkspaceId })
    .from(sessionMethods)
    .where(eq(sessionMethods.sessionId, sessionId))
  const method = row?.method
  if (method === 'workspace-oidc') return row?.scope ? { scopedTo: row.scope } : undefined
  return method === 'password' || method === 'email' || method === 'oidc' ? method : undefined
}

/**
 * SQL: the workspace in `workspaceId` accepts a session that signed in with `method`. Single
 * sign-on is always accepted; a session of unknown method only where nothing is restricted.
 * `undefined` (not a dashboard session, e.g. the CLI) applies no restriction.
 */
export function workspaceAccepts(workspaceId: AnyPgColumn, method: SessionMethod | undefined): SQL {
  if (method === undefined || method === 'oidc') return sql`true`
  if (typeof method === 'object') return sql`${workspaceId} = ${method.scopedTo}`
  const restricted =
    method === 'password'
      ? sql`${workspaceAuthSettings.passwordLoginEnabled} = false`
      : method === 'email'
        ? sql`${workspaceAuthSettings.emailLoginEnabled} = false`
        : sql`(${workspaceAuthSettings.passwordLoginEnabled} = false or ${workspaceAuthSettings.emailLoginEnabled} = false)`
  return sql`not exists (select 1 from ${workspaceAuthSettings} where ${workspaceAuthSettings.workspaceId} = ${workspaceId} and ${restricted})`
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

/** Workspaces the user belongs to but whose rules refuse this session's login method. */
export async function listRefusingWorkspaces(
  db: Database,
  userId: string,
  method: SessionMethod,
): Promise<{ name: string; accepts: ('password' | 'email')[] }[]> {
  const rows = await db
    .select({
      name: workspace.name,
      email: workspaceAuthSettings.emailLoginEnabled,
      password: workspaceAuthSettings.passwordLoginEnabled,
    })
    .from(member)
    .innerJoin(workspace, eq(workspace.id, member.workspaceId))
    .innerJoin(workspaceAuthSettings, eq(workspaceAuthSettings.workspaceId, workspace.id))
    .where(and(eq(member.userId, userId), sql`not (${workspaceAccepts(workspace.id, method)})`))
  return rows.map((r) => ({
    name: r.name,
    accepts: [
      ...(r.password ? (['password'] as const) : []),
      ...(r.email ? (['email'] as const) : []),
    ],
  }))
}

/** Whether any owner of the workspace could still sign in, given which methods are on. */
async function ownerCanSignIn(
  db: Database,
  workspaceId: string,
  on: { password: boolean; email: boolean; oidc: boolean },
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
    if (on.password && accounts.some((a) => a.provider === 'credential')) return true
    if (on.oidc && accounts.some((a) => a.provider !== 'credential')) return true
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
