import { sso } from '@better-auth/sso'

/**
 * Single sign-on providers added by a workspace's owners and admins (PLAN §7.8). These are
 * *untrusted* beyond their own workspace: the identity provider is theirs, so it could claim
 * any email address. Therefore:
 *
 * - an identity is matched by (provider, subject), never by email;
 * - a login whose email already belongs to some other account is refused, not linked;
 * - a new account joins only the provider's workspace, as a member;
 * - the session it creates only opens that workspace (see `hooks/session-created.ts`).
 */
export function workspaceSsoPlugin() {
  return sso({
    // The workspace's own provider brings its people in as members of that workspace.
    organizationProvisioning: { defaultRole: 'member' },
    schema: { ssoProvider: { fields: { organizationId: 'workspaceId' } } },
    providersLimit: 3,
    resolveUser: async (input, context) => {
      const email = input.providerUser.email.trim().toLowerCase()
      if (!email)
        return { action: 'reject', code: 'NO_EMAIL', message: 'The provider sent no email' }

      const known = await context.database.findOne<{ userId: string }>({
        model: 'account',
        where: [
          { field: 'providerId', value: input.providerId },
          { field: 'accountId', value: input.accountKey.accountId },
        ],
      })
      if (known) return { action: 'link', userId: known.userId, profile: 'preserve' }

      const existing = await context.database.findOne<{ id: string }>({
        model: 'user',
        where: [{ field: 'email', value: email }],
      })
      if (existing) {
        return {
          action: 'reject',
          code: 'ACCOUNT_EXISTS',
          message: 'That address already has an account. Sign in the way you did before.',
        }
      }
      return { action: 'continue' }
    },
  })
}
