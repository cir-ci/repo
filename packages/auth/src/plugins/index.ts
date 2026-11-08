import { apiKey } from '@better-auth/api-key'
import { admin, organization } from 'better-auth/plugins'

import { CI_KEY_CONFIG, CI_KEY_PREFIX, INVITATION_TTL_SECONDS } from '#src/constants.ts'
import { invitationMail } from '#src/mail.ts'
import type { PluginOptions } from '#src/options.ts'

import { emailLoginPlugin } from './email-login.ts'
import { orgSsoPlugin } from './org-sso.ts'
import { ssoPlugins } from './sso.ts'

/**
 * Plugins, shared with `schema-config.ts` so the generated tables always match what runs.
 * After changing them: `pnpm db:auth-schema`, then `pnpm db:generate`.
 */
export function authPlugins(options: PluginOptions = {}) {
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
    orgSsoPlugin(),
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
