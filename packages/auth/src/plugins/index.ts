import { apiKey } from '@better-auth/api-key'
import { removeUserFromWorkspaceTeams } from '@circi/db/repositories'
import { admin, organization } from 'better-auth/plugins'

import { CI_KEY_CONFIG, CI_KEY_PREFIX, INVITATION_TTL_SECONDS } from '#src/constants.ts'
import { invitationMail } from '#src/mail.ts'
import type { PluginOptions } from '#src/options.ts'

import { emailLoginPlugin } from './email-login.ts'
import { ssoPlugins } from './sso/plugin.ts'
import { workspaceSsoPlugin } from './workspace-sso.ts'

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
      // better-auth's `organization` plugin is CirCI's workspace: its tables and columns are renamed
      // here, while its API (`/organization/…`, `organizationId`, `activeOrganizationId`) keeps its names.
      schema: {
        session: { fields: { activeOrganizationId: 'activeWorkspaceId' } },
        organization: { modelName: 'workspace' },
        member: { fields: { organizationId: 'workspaceId' } },
        invitation: { fields: { organizationId: 'workspaceId' } },
      },
      organizationHooks: {
        // Someone who leaves or is removed from a workspace leaves all its teams (and their
        // review rules and triage rotations) with them. Nothing is left that names them there,
        // and every team list also checks workspace membership, so a failure here never shows
        // a team to someone who is out.
        afterRemoveMember: async ({ member, organization: workspace }) => {
          const db = options.db
          if (!db) return
          await db.transaction((tx) =>
            removeUserFromWorkspaceTeams(tx, {
              workspaceId: workspace.id,
              userId: member.userId,
            }),
          )
        },
      },
      sendInvitationEmail: async ({ email, organization: workspace, inviter, role, id }) => {
        if (!options.mailer || !options.baseURL) return
        void options.mailer
          .send(
            invitationMail({
              to: email,
              invitationId: id,
              workspaceName: workspace.name,
              inviterName: inviter.user.name,
              role,
              origin: options.baseURL,
            }),
          )
          .catch((err: unknown) => options.onMailError?.(err))
      },
    }),
    ...ssoPlugins(options.sso ?? []),
    workspaceSsoPlugin(),
    apiKey([
      {
        configId: CI_KEY_CONFIG,
        references: 'organization',
        defaultPrefix: CI_KEY_PREFIX,
        enableMetadata: true,
        // Keep `circi_` plus six characters, so the dashboard can say which token is current.
        startingCharactersConfig: { shouldStore: true, charactersLength: CI_KEY_PREFIX.length + 6 },
        // The plugin's default (10 requests a day per key) would stop a single CI run.
        rateLimit: { enabled: false },
      },
    ]),
  ]
}
