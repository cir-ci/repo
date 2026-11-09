import { sql, type SQL } from 'drizzle-orm'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'

import { type LoginMethod, workspaceAuthSettings, workspaceDeletions } from '#schema/index.ts'

/** Which login method a session used, and the SQL that decides what a workspace shows it. */

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
