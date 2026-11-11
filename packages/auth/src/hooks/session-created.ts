import { randomUUID } from 'node:crypto'

import { type Database } from '@circi/db'
import { isSwitchableProvider } from '@circi/db/queries'
import {
  deviceFingerprint,
  noteDevice,
  workspacesForEmailDomain,
  recordSessionMethod,
  type SessionMethod,
} from '@circi/db/repositories'
import { type LoginMethod } from '@circi/db/schema'
import * as schema from '@circi/db/schema'
import { and, eq } from 'drizzle-orm'

import { isTrusted, ssoProviderOf } from '#plugins/sso/sso.ts'
import { newSignInMail } from '#src/mail.ts'
import type { AuthOptions } from '#src/options.ts'

/** How a sign-in came in, from the better-auth endpoint that created the session. */
function loginMethodOf(path: string | undefined): LoginMethod | undefined {
  if (!path) return undefined
  if (path === '/sign-in/email') return 'password'
  if (path === '/sign-in/email-otp') return 'email'
  if (path.startsWith('/callback/')) return 'oidc'
  // A workspace's own provider (registered through the SSO plugin).
  if (path.startsWith('/sso/callback')) return 'workspace-oidc'
  return undefined
}

async function providerWorkspace(
  db: Database,
  context: { params?: unknown } | null,
): Promise<string | undefined> {
  const params = context?.params
  const providerId: unknown =
    typeof params === 'object' && params !== null ? Reflect.get(params, 'providerId') : undefined
  if (typeof providerId !== 'string') return undefined
  const [row] = await db
    .select({ workspaceId: schema.ssoProvider.workspaceId })
    .from(schema.ssoProvider)
    .where(eq(schema.ssoProvider.providerId, providerId))
  return row?.workspaceId ?? undefined
}

/** Mails the account's owner when someone signs in from a browser it hasn't been used from. */
async function warnAboutNewDevice(
  options: AuthOptions,
  session: { userId: string; userAgent?: string | null; ipAddress?: string | null },
  method: LoginMethod,
): Promise<void> {
  const seen = await noteDevice(options.db, session.userId, deviceFingerprint(session.userAgent))
  if (seen !== 'new' || !options.mailer) return
  const [user] = await options.db
    .select({ email: schema.user.email, name: schema.user.name })
    .from(schema.user)
    .where(eq(schema.user.id, session.userId))
  if (!user) return
  const label =
    method === 'password' ? 'password' : method === 'email' ? 'email code' : 'single sign-on'
  void options.mailer
    .send(
      newSignInMail({
        to: user.email,
        name: user.name,
        when: new Date(),
        method: label,
        userAgent: session.userAgent ?? null,
        ipAddress: session.ipAddress ?? null,
        origin: options.baseURL,
      }),
    )
    .catch((err: unknown) => options.onMailError?.(err))
}

/** Adds the user to every workspace that claimed (and proved) their email's domain. */
export async function joinByVerifiedDomain(
  db: Database,
  userId: string,
  options: { requireVerifiedEmail?: boolean; method?: SessionMethod } = {},
): Promise<void> {
  const [user] = await db
    .select({ email: schema.user.email, emailVerified: schema.user.emailVerified })
    .from(schema.user)
    .where(eq(schema.user.id, userId))
  if (!user || (options.requireVerifiedEmail && !user.emailVerified)) return
  for (const { workspaceId, role } of await workspacesForEmailDomain(
    db,
    user.email,
    options.method,
  )) {
    // Written directly, like better-auth's own addMember would; an existing seat is left alone.
    // eslint-disable-next-line no-await-in-loop -- a handful of workspaces at most
    const [existing] = await db
      .select({ id: schema.member.id })
      .from(schema.member)
      .where(and(eq(schema.member.workspaceId, workspaceId), eq(schema.member.userId, userId)))
    if (existing) continue
    // eslint-disable-next-line no-await-in-loop
    await db
      .insert(schema.member)
      .values({ id: randomUUID(), workspaceId: workspaceId, userId, role, createdAt: new Date() })
  }
}

/**
 * After a session is created: remember how it signed in (a workspace may refuse some
 * methods), warn about a new device, and join verified email domains.
 */
export function onSessionCreated(options: AuthOptions) {
  return async (
    created: { id: string; userId: string; userAgent?: string | null; ipAddress?: string | null },
    context: { path?: string; params?: unknown } | null,
  ) => {
    let method = loginMethodOf(context?.path)
    if (!method) return
    let scopeWorkspaceId: string | undefined
    if (method === 'workspace-oidc') {
      // A provider an instance admin registered has no workspace: it behaves like the
      // instance-wide ones. One a workspace registered opens only that workspace.
      scopeWorkspaceId = await providerWorkspace(options.db, context)
      if (!scopeWorkspaceId) method = 'oidc'
    }
    const provider = method === 'oidc' ? ssoProviderOf(context) : undefined
    await recordSessionMethod(options.db, created.id, method, scopeWorkspaceId, provider)
    await warnAboutNewDevice(options, created, method)
    // An emailed code proves the person owns the address, so a verified domain claim may add
    // them to its workspace. (A password or a workspace's own identity provider proves
    // nothing about the address, so they never do.)
    if (method === 'email') await joinByVerifiedDomain(options.db, created.userId)
    if (method === 'oidc' && isTrusted(options.sso, ssoProviderOf(context))) {
      // A workspace that switched GitHub or Google off is not joined through it.
      await joinByVerifiedDomain(options.db, created.userId, {
        requireVerifiedEmail: true,
        ...(isSwitchableProvider(provider) ? { method: { oidcProvider: provider } } : {}),
      })
    }
  }
}
