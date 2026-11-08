import { randomUUID } from 'node:crypto'

import {
  deviceFingerprint,
  type Database,
  type LoginMethod,
  noteDevice,
  organizationsForEmailDomain,
  recordSessionMethod,
  schema,
} from '@circi/db'
import { and, eq } from 'drizzle-orm'

import { newSignInMail } from '#src/mail.ts'
import type { AuthOptions } from '#src/options.ts'
import { isTrusted, ssoProviderOf } from '#sso/sso.ts'

/** How a sign-in came in, from the better-auth endpoint that created the session. */
function loginMethodOf(path: string | undefined): LoginMethod | undefined {
  if (!path) return undefined
  if (path === '/sign-in/email') return 'password'
  if (path === '/sign-in/email-otp') return 'email'
  if (path.startsWith('/callback/')) return 'oidc'
  // An organization's own provider (registered through the SSO plugin).
  if (path.startsWith('/sso/callback')) return 'org-oidc'
  return undefined
}

async function providerOrganization(
  db: Database,
  context: { params?: unknown } | null,
): Promise<string | undefined> {
  const params = context?.params
  const providerId: unknown =
    typeof params === 'object' && params !== null ? Reflect.get(params, 'providerId') : undefined
  if (typeof providerId !== 'string') return undefined
  const [row] = await db
    .select({ organizationId: schema.ssoProvider.organizationId })
    .from(schema.ssoProvider)
    .where(eq(schema.ssoProvider.providerId, providerId))
  return row?.organizationId ?? undefined
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

/** Adds the user to every organization that claimed (and proved) their email's domain. */
async function joinByVerifiedDomain(
  db: Database,
  userId: string,
  options: { requireVerifiedEmail?: boolean } = {},
): Promise<void> {
  const [user] = await db
    .select({ email: schema.user.email, emailVerified: schema.user.emailVerified })
    .from(schema.user)
    .where(eq(schema.user.id, userId))
  if (!user || (options.requireVerifiedEmail && !user.emailVerified)) return
  for (const { orgId, role } of await organizationsForEmailDomain(db, user.email)) {
    // Written directly, like better-auth's own addMember would; an existing seat is left alone.
    // eslint-disable-next-line no-await-in-loop -- a handful of organizations at most
    const [existing] = await db
      .select({ id: schema.member.id })
      .from(schema.member)
      .where(and(eq(schema.member.organizationId, orgId), eq(schema.member.userId, userId)))
    if (existing) continue
    // eslint-disable-next-line no-await-in-loop
    await db
      .insert(schema.member)
      .values({ id: randomUUID(), organizationId: orgId, userId, role, createdAt: new Date() })
  }
}

/**
 * After a session is created: remember how it signed in (an organization may refuse some
 * methods), warn about a new device, and join verified email domains.
 */
export function onSessionCreated(options: AuthOptions) {
  return async (
    created: { id: string; userId: string; userAgent?: string | null; ipAddress?: string | null },
    context: { path?: string; params?: unknown } | null,
  ) => {
    let method = loginMethodOf(context?.path)
    if (!method) return
    let scopeOrgId: string | undefined
    if (method === 'org-oidc') {
      // A provider an instance admin registered has no organization: it behaves like the
      // instance-wide ones. One an organization registered opens only that organization.
      scopeOrgId = await providerOrganization(options.db, context)
      if (!scopeOrgId) method = 'oidc'
    }
    await recordSessionMethod(options.db, created.id, method, scopeOrgId)
    await warnAboutNewDevice(options, created, method)
    // An emailed code proves the person owns the address, so a verified domain claim may add
    // them to its organization. (A password or an organization's own identity provider proves
    // nothing about the address, so they never do.)
    if (method === 'email') await joinByVerifiedDomain(options.db, created.userId)
    if (method === 'oidc' && isTrusted(options.sso, ssoProviderOf(context))) {
      await joinByVerifiedDomain(options.db, created.userId, { requireVerifiedEmail: true })
    }
  }
}
