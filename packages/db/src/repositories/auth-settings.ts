import { and, eq, sql, type SQL } from 'drizzle-orm'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'

import type { Database } from '../client.ts'
import { ConflictError } from '../errors.ts'
import {
  account,
  type LoginMethod,
  member,
  orgAuthSettings,
  organization,
  sessionMethods,
} from '../schema/index.ts'

/**
 * Login methods per organization (PLAN §7.8). The instance switches are the outer limit;
 * an organization can only narrow them. The method a session signed in with is remembered, and
 * an organization's content is only shown to sessions whose method it accepts.
 */

export type { LoginMethod }

/** A session's login method, or `unknown` for sessions that predate the record. */
export type SessionMethod = LoginMethod | 'unknown'

/** What the instance offers; the caller derives it from config. */
export interface InstanceMethods {
  password: boolean
  email: boolean
  oidc: boolean
}

export interface OrgAuthSettings {
  emailLoginEnabled: boolean
  passwordLoginEnabled: boolean
}

const DEFAULTS: OrgAuthSettings = { emailLoginEnabled: true, passwordLoginEnabled: true }

export async function getOrgAuthSettings(db: Database, orgId: string): Promise<OrgAuthSettings> {
  const [row] = await db.select().from(orgAuthSettings).where(eq(orgAuthSettings.orgId, orgId))
  return row
    ? { emailLoginEnabled: row.emailLoginEnabled, passwordLoginEnabled: row.passwordLoginEnabled }
    : DEFAULTS
}

export async function recordSessionMethod(
  db: Database,
  sessionId: string,
  method: LoginMethod,
): Promise<void> {
  await db
    .insert(sessionMethods)
    .values({ sessionId, method })
    .onConflictDoUpdate({ target: sessionMethods.sessionId, set: { method } })
}

/** How a session signed in; `undefined` for sessions that predate the record. */
export async function getSessionMethod(
  db: Database,
  sessionId: string,
): Promise<LoginMethod | undefined> {
  const [row] = await db
    .select({ method: sessionMethods.method })
    .from(sessionMethods)
    .where(eq(sessionMethods.sessionId, sessionId))
  const method = row?.method
  return method === 'password' || method === 'email' || method === 'oidc' ? method : undefined
}

/**
 * SQL: the organization in `orgId` accepts a session that signed in with `method`. Single
 * sign-on is always accepted; a session of unknown method only where nothing is restricted.
 * `undefined` (not a dashboard session, e.g. the CLI) applies no restriction.
 */
export function orgAccepts(orgId: AnyPgColumn, method: SessionMethod | undefined): SQL {
  if (method === undefined || method === 'oidc') return sql`true`
  const restricted =
    method === 'password'
      ? sql`${orgAuthSettings.passwordLoginEnabled} = false`
      : method === 'email'
        ? sql`${orgAuthSettings.emailLoginEnabled} = false`
        : sql`(${orgAuthSettings.passwordLoginEnabled} = false or ${orgAuthSettings.emailLoginEnabled} = false)`
  return sql`not exists (select 1 from ${orgAuthSettings} where ${orgAuthSettings.orgId} = ${orgId} and ${restricted})`
}

/** Whether the organization accepts a session that signed in with `method`. */
export async function orgAcceptsSession(
  db: Database,
  orgId: string,
  method: SessionMethod | undefined,
): Promise<boolean> {
  const [row] = await db
    .select({ id: organization.id })
    .from(organization)
    .where(and(eq(organization.id, orgId), orgAccepts(organization.id, method)))
  return row !== undefined
}

/** Organizations the user belongs to but whose rules refuse this session's login method. */
export async function listRefusingOrganizations(
  db: Database,
  userId: string,
  method: SessionMethod,
): Promise<{ name: string; accepts: ('password' | 'email')[] }[]> {
  const rows = await db
    .select({
      name: organization.name,
      email: orgAuthSettings.emailLoginEnabled,
      password: orgAuthSettings.passwordLoginEnabled,
    })
    .from(member)
    .innerJoin(organization, eq(organization.id, member.organizationId))
    .innerJoin(orgAuthSettings, eq(orgAuthSettings.orgId, organization.id))
    .where(and(eq(member.userId, userId), sql`not (${orgAccepts(organization.id, method)})`))
  return rows.map((r) => ({
    name: r.name,
    accepts: [
      ...(r.password ? (['password'] as const) : []),
      ...(r.email ? (['email'] as const) : []),
    ],
  }))
}

/** Whether any owner of the org could still sign in, given which methods are on. */
async function ownerCanSignIn(
  db: Database,
  orgId: string,
  on: { password: boolean; email: boolean; oidc: boolean },
): Promise<boolean> {
  if (on.email) return true // any account can ask for a code
  const owners = await db
    .select({ userId: member.userId })
    .from(member)
    .where(and(eq(member.organizationId, orgId), eq(member.role, 'owner')))
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
 * Saves an organization's switches. Refused when it would leave no owner able to sign in with
 * any method that's on (the lockout guard); `force` skips that, for the break-glass CLI.
 */
export async function setOrgAuthSettings(
  db: Database,
  orgId: string,
  patch: Partial<OrgAuthSettings>,
  options: { instance: InstanceMethods; force?: boolean },
): Promise<OrgAuthSettings> {
  const next = { ...(await getOrgAuthSettings(db, orgId)), ...patch }
  if (!options.force) {
    const on = {
      password: options.instance.password && next.passwordLoginEnabled,
      email: options.instance.email && next.emailLoginEnabled,
      oidc: options.instance.oidc,
    }
    if (!(await ownerCanSignIn(db, orgId, on))) {
      throw new ConflictError(
        'That would leave no owner able to sign in. Keep a method on that an owner can use.',
      )
    }
  }
  await db
    .insert(orgAuthSettings)
    .values({ orgId, ...next })
    .onConflictDoUpdate({ target: orgAuthSettings.orgId, set: { ...next, updatedAt: new Date() } })
  return next
}
