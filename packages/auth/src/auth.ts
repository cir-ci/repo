import { apiKey } from '@better-auth/api-key'
import { drizzleAdapter } from '@better-auth/drizzle-adapter'
import type { Database } from '@circi/db'
import { schema } from '@circi/db'
import { betterAuth } from 'better-auth'
import { admin, emailOTP, organization } from 'better-auth/plugins'

import { type Mailer, signInMail } from './mail.ts'

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
  /** Called when sending a mail fails (it's never awaited, so sign-in timing doesn't leak). */
  onMailError?: (err: unknown) => void
}

type LoginMailOptions = Partial<Pick<AuthOptions, 'mailer' | 'onMailError' | 'baseURL'>>

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
    organization({ allowUserToCreateOrganization: false }),
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
    disableSignUp: true,
    // Not awaited: waiting for the mail server would show which addresses have accounts.
    sendVerificationOTP: async ({ email, otp, type }) => {
      if (type !== 'sign-in' || !options.mailer || !options.baseURL) return
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
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: MIN_PASSWORD_LENGTH,
    },
    advanced: {
      cookiePrefix: 'circi',
      ...hostCookies(options.baseURL),
    },
    plugins: authPlugins(options),
  })
}

export type Auth = ReturnType<typeof createAuth>
