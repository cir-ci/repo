import { and, eq } from 'drizzle-orm'

import { getWorkspaceAuthSettings } from '#queries/auth-settings.ts'
import {
  account,
  type LoginMethod,
  member,
  sessionMethods,
  workspaceAuthSettings,
} from '#schema/index.ts'
import type { Database } from '#src/client.ts'
import { ConflictError } from '#src/errors.ts'
export * from '#shared/session-method.ts'

/**
 * Login methods per workspace (PLAN §7.8). The instance switches are the outer limit;
 * a workspace can only narrow them. The method a session signed in with is remembered, and
 * a workspace's content is only shown to sessions whose method it accepts.
 */

export type { LoginMethod }

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
