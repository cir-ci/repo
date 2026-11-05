import { drizzleAdapter } from '@better-auth/drizzle-adapter'
import { schema } from '@circi/db'
import { betterAuth } from 'better-auth'

import { MIN_PASSWORD_LENGTH } from './constants.ts'
import { hostCookies } from './cookies.ts'
import { beforeAccountCreate } from './hooks/account-create.ts'
import { requestGuard } from './hooks/request-guard.ts'
import { onSessionCreated } from './hooks/session-created.ts'
import { beforeUserCreate } from './hooks/user-create.ts'
import type { AuthOptions } from './options.ts'
import { authPlugins } from './plugins/index.ts'
import { socialProviders } from './plugins/sso.ts'

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
 *
 * This file only composes: plugins live in `plugins/`, the rules around sign-in in `hooks/`.
 */
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
    hooks: { before: requestGuard(options) },
    databaseHooks: {
      session: { create: { after: onSessionCreated(options) } },
      account: { create: { before: beforeAccountCreate(options) } },
      user: { create: { before: beforeUserCreate(options) } },
    },
    plugins: authPlugins(options),
  })
}

export namespace createAuth {
  export type Options = AuthOptions
}

export type Auth = ReturnType<typeof createAuth>
