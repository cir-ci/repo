import { randomUUID } from 'node:crypto'

import { apiKey } from '@better-auth/api-key'
import { drizzleAdapter } from '@better-auth/drizzle-adapter'
import type { Database } from '@circi/db'
import {
  getSessionMethod,
  organizationsForEmailDomain,
  type LoginMethod,
  orgAcceptsSession,
  recordSessionMethod,
  schema,
} from '@circi/db'
import { betterAuth } from 'better-auth'
import { APIError, createAuthMiddleware, getSessionFromCtx } from 'better-auth/api'
import { admin, emailOTP, genericOAuth, organization } from 'better-auth/plugins'
import { and, eq, gt, sql } from 'drizzle-orm'

import { invitationMail, type Mailer, signInMail } from './mail.ts'
import { isSsoPath, mayCreateSsoAccount, mayLinkSsoAccount, type SsoProvider } from './sso.ts'

/**
 * Authentication, provided by better-auth (https://better-auth.com):
 *
 * - **Accounts and sessions** for the dashboard: email + password, httpOnly session cookies.
 *   Self sign-up is off (PLAN §8: invite-only by default); accounts come from the admin CLI.
 * - **Organizations** (organization plugin): orgs, members with owner/admin/member roles,
 *   invitations. Projects belong to an organization.
 * - **CI tokens** (api-key plugin, config `ci`): keys owned by an organization, prefixed `circi_`,
 *   stored hashed, with the project id in their metadata.
 * - **Instance admins** (admin plugin): the operator role, and server-side user creation.
 */

/** Same minimum as the sign-in form; the admin plugin's createUser doesn't apply it. */
export const MIN_PASSWORD_LENGTH = 12

export const CI_KEY_CONFIG = 'ci'
export const CI_KEY_PREFIX = 'circi_'

export interface AuthOptions {
  db: Database
  /** BETTER_AUTH_SECRET: signs sessions and cookies. */
  secret: string
  /** The dashboard origin (PUBLIC_URL); auth lives under `${baseURL}/api/auth`. */
  baseURL: string
  /**
   * Sends the email sign-in codes. Without it the email-code endpoints exist but send nothing;
   * the server only exposes them when email login is switched on.
   */
  mailer?: Mailer
  /** Email + password sign-in is on (default). Off: only email codes (and later SSO) work. */
  passwordLogin?: boolean
  /** Single sign-on providers the operator set up. None: sign-in is password and email only. */
  sso?: SsoProvider[]
  /** Called when sending a mail fails (it's never awaited, so sign-in timing doesn't leak). */
  onMailError?: (err: unknown) => void
}

type LoginMailOptions = Partial<
  Pick<AuthOptions, 'db' | 'mailer' | 'onMailError' | 'baseURL' | 'sso'>
>

/** How long an invitation can be accepted. */
export const INVITATION_TTL_SECONDS = 7 * 24 * 3600

/** Whether someone invited this address and the invitation can still be accepted. */
export async function hasPendingInvitation(db: Database, email: string): Promise<boolean> {
  const [row] = await db
    .select({ id: schema.invitation.id })
    .from(schema.invitation)
    .where(
      and(
        sql`lower(${schema.invitation.email}) = ${email.toLowerCase()}`,
        eq(schema.invitation.status, 'pending'),
        gt(schema.invitation.expiresAt, new Date()),
      ),
    )
    .limit(1)
  return row !== undefined
}

async function hasAccount(db: Database, email: string): Promise<boolean> {
  const [row] = await db
    .select({ id: schema.user.id })
    .from(schema.user)
    .where(sql`lower(${schema.user.email}) = ${email.toLowerCase()}`)
    .limit(1)
  return row !== undefined
}

/** How long an emailed sign-in code works. */
export const EMAIL_CODE_TTL_SECONDS = 600

/**
 * Plugins, shared with `schema-config.ts` so the generated tables always match what runs.
 * After changing them: `pnpm db:auth-schema`, then `pnpm db:generate`.
 */
export function authPlugins(options: LoginMailOptions = {}) {
  return [
    admin(),
    emailLoginPlugin(options),
    organization({
      allowUserToCreateOrganization: false,
      invitationExpiresIn: INVITATION_TTL_SECONDS,
      cancelPendingInvitationsOnReInvite: true,
      sendInvitationEmail: async ({ email, organization: org, inviter, role, id }) => {
        if (!options.mailer || !options.baseURL) return
        void options.mailer
          .send(
            invitationMail({
              to: email,
              invitationId: id,
              organizationName: org.name,
              inviterName: inviter.user.name,
              role,
              origin: options.baseURL,
            }),
          )
          .catch((err: unknown) => options.onMailError?.(err))
      },
    }),
    ...ssoPlugins(options.sso ?? []),
    apiKey([
      {
        configId: CI_KEY_CONFIG,
        references: 'organization',
        defaultPrefix: CI_KEY_PREFIX,
        enableMetadata: true,
        // The plugin's default (10 requests a day per key) would stop a single CI run.
        rateLimit: { enabled: false },
      },
    ]),
  ]
}

/** The generic OpenID Connect provider is a plugin; GitHub and Google are built in. */
function ssoPlugins(providers: SsoProvider[]) {
  const oidc = providers.find((p) => p.id === 'oidc')
  if (!oidc?.issuer) return []
  return [
    genericOAuth({
      config: [
        {
          providerId: 'oidc',
          discoveryUrl: `${oidc.issuer.replace(/\/$/, '')}/.well-known/openid-configuration`,
          clientId: oidc.clientId,
          clientSecret: oidc.clientSecret,
          scopes: ['openid', 'email', 'profile'],
          pkce: true,
        },
      ],
    }),
  ]
}

function socialProviders(providers: SsoProvider[]) {
  const pick = (id: 'github' | 'google') => {
    const p = providers.find((x) => x.id === id)
    return p ? { clientId: p.clientId, clientSecret: p.clientSecret } : undefined
  }
  const github = pick('github')
  const google = pick('google')
  return { ...(github ? { github } : {}), ...(google ? { google } : {}) }
}

/**
 * Email login (PLAN §7.8): a 6-digit code, mailed together with a link that opens the sign-in
 * page with the code filled in (in the URL fragment, so servers and proxies never see it). The
 * page still needs a click, so mail scanners that open links can't use the code up.
 * Unknown addresses get no mail and the same answer (`disableSignUp`).
 */
function emailLoginPlugin(options: LoginMailOptions) {
  return emailOTP({
    otpLength: 6,
    expiresIn: EMAIL_CODE_TTL_SECONDS,
    allowedAttempts: 5,
    storeOTP: 'hashed',
    // Signing in with a code creates the account of someone who was invited (the code proves
    // they own the address); for anyone else no mail is sent, and `databaseHooks` in
    // `createAuth` refuses to create the account anyway.
    disableSignUp: false,
    // Not awaited: waiting for the mail server would show which addresses have accounts.
    sendVerificationOTP: async ({ email, otp, type }) => {
      if (type !== 'sign-in' || !options.mailer || !options.baseURL || !options.db) return
      if (
        !(await hasAccount(options.db, email)) &&
        !(await hasPendingInvitation(options.db, email)) &&
        (await organizationsForEmailDomain(options.db, email)).length === 0
      ) {
        return
      }
      void options.mailer
        .send(signInMail(email, otp, options.baseURL))
        .catch((err: unknown) => options.onMailError?.(err))
    },
  })
}

const hostCookie = (name: string) => ({
  name: `__Host-circi.${name}`,
  attributes: { secure: true, path: '/' },
})

/**
 * Over https, dashboard cookies get the `__Host-` prefix (PLAN §7.6): browsers then only accept
 * them if they're Secure, have no Domain and Path=/, so a hosted site on a subdomain can't set
 * or overwrite them. better-auth's own `useSecureCookies` would give the weaker `__Secure-`
 * prefix, so it's off and the names and attributes are set here. Over plain http (local
 * development) `__Host-` cookies can't work, so better-auth's defaults apply.
 */
function hostCookies(baseURL: string) {
  if (!baseURL.startsWith('https://')) return { useSecureCookies: false }
  return {
    useSecureCookies: false,
    cookies: {
      session_token: hostCookie('session_token'),
      session_data: hostCookie('session_data'),
      account_data: hostCookie('account_data'),
      dont_remember: hostCookie('dont_remember'),
    },
  }
}

export function createAuth(options: AuthOptions) {
  return betterAuth({
    appName: 'CirCI',
    baseURL: options.baseURL,
    basePath: '/api/auth',
    secret: options.secret,
    database: drizzleAdapter(options.db, {
      provider: 'pg',
      schema: {
        user: schema.user,
        session: schema.session,
        account: schema.account,
        verification: schema.verification,
        organization: schema.organization,
        member: schema.member,
        invitation: schema.invitation,
        apikey: schema.apikey,
      },
    }),
    ...(options.sso?.length ? { socialProviders: socialProviders(options.sso) } : {}),
    account: {
      accountLinking: {
        enabled: true,
        trustedProviders: (options.sso ?? []).filter((p) => p.trustedForEmail).map((p) => p.id),
      },
    },
    emailAndPassword: {
      enabled: options.passwordLogin !== false,
      disableSignUp: true,
      minPasswordLength: MIN_PASSWORD_LENGTH,
    },
    advanced: {
      cookiePrefix: 'circi',
      ...hostCookies(options.baseURL),
    },
    hooks: {
      // better-auth's own organization endpoints (members, invitations) obey an organization's
      // login-method rules like the rest of the dashboard: a refused session gets "not found".
      before: createAuthMiddleware(async (ctx) => {
        if (!ctx.path.startsWith('/organization/')) return
        const ref = organizationRef(ctx.body) ?? organizationRef(ctx.query)
        if (!ref) return
        const session = await getSessionFromCtx(ctx)
        if (!session) return
        const [org] = await options.db
          .select({ id: schema.organization.id })
          .from(schema.organization)
          .where(
            ref.id
              ? eq(schema.organization.id, ref.id)
              : eq(schema.organization.slug, ref.slug ?? ''),
          )
        if (!org) return
        const method = (await getSessionMethod(options.db, session.session.id)) ?? 'unknown'
        if (!(await orgAcceptsSession(options.db, org.id, method))) {
          throw new APIError('NOT_FOUND', { message: 'Organization not found' })
        }
      }),
    },
    databaseHooks: {
      session: {
        create: {
          // Remember how this session signed in: an organization may refuse some methods.
          after: async (created, context) => {
            const method = loginMethodOf(context?.path)
            if (!method) return
            await recordSessionMethod(options.db, created.id, method)
            // An emailed code proves the person owns the address, so a verified domain claim
            // may add them to its organization. (A password or an organization's own
            // identity provider proves nothing about the address, so they never do.)
            if (method === 'email') await joinByVerifiedDomain(options.db, created.userId)
            if (method === 'oidc' && isTrusted(options.sso, ssoProviderOf(context))) {
              await joinByVerifiedDomain(options.db, created.userId, { requireVerifiedEmail: true })
            }
          },
        },
      },
      account: {
        create: {
          // A login with a provider the operator doesn't vouch for must not attach to an
          // account that already existed, even if the provider claims the email is verified.
          before: async (created, context) => {
            if (!isSsoPath(context?.path)) return
            const [owner] = await options.db
              .select({ createdAt: schema.user.createdAt })
              .from(schema.user)
              .where(eq(schema.user.id, created.userId))
            const accountAgeMs = owner ? Date.now() - owner.createdAt.getTime() : 0
            if (
              !mayLinkSsoAccount({
                trusted: isTrusted(options.sso, created.providerId),
                accountAgeMs,
              })
            ) {
              throw new APIError('FORBIDDEN', {
                message: 'This sign-in provider is not trusted to link to an existing account',
              })
            }
          },
        },
      },
      user: {
        create: {
          before: async (_user, context) => {
            // Only the email-code sign-in can create accounts on its own: for invitees, and for
            // people on a domain some organization has verified.
            const email = typeof _user.email === 'string' ? _user.email : ''
            if (isSsoPath(context?.path)) {
              // Single sign-on never opens the door by itself (no self sign-up).
              const allowed = mayCreateSsoAccount({
                trusted: isTrusted(options.sso, ssoProviderOf(context)),
                emailVerified: _user.emailVerified,
                invited: await hasPendingInvitation(options.db, email),
                onVerifiedDomain: (await organizationsForEmailDomain(options.db, email)).length > 0,
              })
              if (!allowed) {
                throw new APIError('FORBIDDEN', { message: 'No account for this address' })
              }
              return
            }
            if (context?.path !== '/sign-in/email-otp') return
            if (
              !(await hasPendingInvitation(options.db, email)) &&
              (await organizationsForEmailDomain(options.db, email)).length === 0
            ) {
              throw new APIError('FORBIDDEN', { message: 'No account for this address' })
            }
          },
        },
      },
    },
    plugins: authPlugins(options),
  })
}

/** The provider a single sign-on callback is for (`/callback/:id`). */
function ssoProviderOf(context: { params?: unknown } | null | undefined): string | undefined {
  const params = context?.params
  if (typeof params !== 'object' || params === null) return undefined
  const id: unknown = Reflect.get(params, 'id')
  return typeof id === 'string' ? id : undefined
}

function isTrusted(providers: SsoProvider[] | undefined, id: string | undefined): boolean {
  return providers?.find((p) => p.id === id)?.trustedForEmail === true
}

/** The organization a request names, by id or slug. */
function organizationRef(source: unknown): { id?: string; slug?: string } | undefined {
  if (typeof source !== 'object' || source === null) return undefined
  const id: unknown = Reflect.get(source, 'organizationId')
  const slug: unknown = Reflect.get(source, 'organizationSlug')
  if (typeof id === 'string' && id) return { id }
  if (typeof slug === 'string' && slug) return { slug }
  return undefined
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

/** How a sign-in came in, from the better-auth endpoint that created the session. */
function loginMethodOf(path: string | undefined): LoginMethod | undefined {
  if (!path) return undefined
  if (path === '/sign-in/email') return 'password'
  if (path === '/sign-in/email-otp') return 'email'
  if (path.startsWith('/callback/')) return 'oidc'
  return undefined
}

export type Auth = ReturnType<typeof createAuth>
