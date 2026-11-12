import { drizzleAdapter } from '@better-auth/drizzle-adapter'
import * as schema from '@circi/db/schema'
import { betterAuth } from 'better-auth'

import { MIN_PASSWORD_LENGTH, SESSION_COOKIE_CACHE_SECONDS } from './constants.ts'
import { hostCookies } from './cookies.ts'
import { beforeAccountCreate } from './hooks/account-create.ts'
import {
  afterEmailChanged,
  EMAIL_CHANGE_TTL_SECONDS,
  sendEmailChangeMails,
  type AuthContextHolder,
} from './hooks/email-change.ts'
import { afterOrganizationRequest } from './hooks/invitations.ts'
import { requestGuard } from './hooks/request-guard.ts'
import { onSessionCreated } from './hooks/session-created.ts'
import { beforeUserCreate, beforeUserUpdate } from './hooks/user-create.ts'
import type { AuthOptions } from './options.ts'
import { authPlugins } from './plugins/index.ts'
import { socialProviders } from './plugins/sso/plugin.ts'
import { trustedOriginsFor } from './plugins/sso/trusted-issuers.ts'

/**
 * Authentication, provided by better-auth (https://better-auth.com):
 *
 * - **Accounts and sessions** for the dashboard: email + password, httpOnly session cookies.
 *   Self sign-up is off (PLAN §8: invite-only by default); accounts come from the admin CLI.
 * - **Workspaces** (better-auth's organization plugin): workspaces, members with owner/admin/member roles,
 *   invitations. Projects belong to a workspace.
 * - **CI tokens** (api-key plugin, config `ci`): keys owned by a workspace, prefixed `circi_`,
 *   stored hashed, with the project id in their metadata.
 * - **Instance admins** (admin plugin): the operator role, and server-side user creation.
 *
 * This file only composes: plugins live in `plugins/`, the rules around sign-in in `hooks/`.
 */
export function createAuth(options: AuthOptions) {
  const holder: AuthContextHolder = {}
  const auth = betterAuth({
    appName: 'CirCI',
    baseURL: options.baseURL,
    basePath: '/api/auth',
    secret: options.secret,
    trustedOrigins: trustedOriginsFor(options.db),
    database: drizzleAdapter(options.db, {
      provider: 'pg',
      // Needed by the workspace single sign-on plugin, which resolves users in a transaction.
      transaction: true,
      schema: {
        user: schema.user,
        session: schema.session,
        account: schema.account,
        verification: schema.verification,
        workspace: schema.workspace,
        member: schema.member,
        invitation: schema.invitation,
        apikey: schema.apikey,
        ssoProvider: schema.ssoProvider,
      },
    }),
    ...(options.sso?.length ? { socialProviders: socialProviders(options.sso) } : {}),
    account: {
      accountLinking: {
        enabled: true,
        trustedProviders: (options.sso ?? []).filter((p) => p.trustedForEmail).map((p) => p.id),
      },
    },
    // Changing the email address: the confirmation link goes to the NEW address (the account keeps the
    // old one until it is opened) and the old address is told. No `sendChangeEmailConfirmation`: that would
    // add a second round trip through the old mailbox, which a person who lost it can't make.
    user: { changeEmail: { enabled: true } },
    emailVerification: {
      expiresIn: EMAIL_CHANGE_TTL_SECONDS,
      sendVerificationEmail: sendEmailChangeMails(options, holder),
      afterEmailVerification: (user) => afterEmailChanged(options, holder, user.id),
    },
    emailAndPassword: {
      enabled: options.passwordLogin !== false,
      disableSignUp: true,
      minPasswordLength: MIN_PASSWORD_LENGTH,
    },
    // The dashboard calls the API a lot: a signed cookie carries the session and user for a short
    // while, so most requests skip the session and user lookups. The price: a session revoked
    // elsewhere (or a banned user) stays valid here for up to `maxAge` seconds.
    session: { cookieCache: { enabled: true, maxAge: SESSION_COOKIE_CACHE_SECONDS } },
    ...(options.rateLimit === undefined ? {} : { rateLimit: { enabled: options.rateLimit } }),
    advanced: {
      cookiePrefix: 'circi',
      ...hostCookies(options.baseURL),
    },
    hooks: { before: requestGuard(options), after: afterOrganizationRequest() },
    databaseHooks: {
      session: { create: { after: onSessionCreated(options) } },
      account: { create: { before: beforeAccountCreate(options) } },
      user: {
        create: { before: beforeUserCreate(options) },
        update: {
          before: beforeUserUpdate(),
          // An instance admin set the address directly; the link flow runs `afterEmailVerification`.
          after: async (user, context) => {
            const data: unknown = context?.path === '/admin/update-user' ? context.body?.data : null
            if (typeof data === 'object' && data !== null && 'email' in data) {
              await afterEmailChanged(options, holder, user.id)
            }
          },
        },
      },
    },
    plugins: authPlugins(options),
  })
  holder.context = auth.$context
  return auth
}

export namespace createAuth {
  export type Options = AuthOptions
}

export type Auth = ReturnType<typeof createAuth>
