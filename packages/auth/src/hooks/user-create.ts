import { organizationsForEmailDomain } from '@circi/db'
import { APIError } from 'better-auth/api'

import { hasPendingInvitation } from '#operations/accounts.ts'
import type { AuthOptions } from '#src/options.ts'
import { isSsoPath, isTrusted, mayCreateSsoAccount, ssoProviderOf } from '#sso/sso.ts'

/**
 * Accounts are never created by self sign-up. Only an email-code sign-in may create one on its
 * own, for invitees and for people on a domain some organization has verified; single sign-on
 * follows the stricter rules in `mayCreateSsoAccount`.
 */
export function beforeUserCreate(options: Pick<AuthOptions, 'db' | 'sso'>) {
  return async (
    user: { email?: unknown; name?: unknown; emailVerified: boolean },
    context: { path?: string; params?: unknown } | null,
  ): Promise<{ data: { emailVerified?: boolean; name?: string } } | undefined> => {
    const email = typeof user.email === 'string' ? user.email : ''
    if (context?.path?.startsWith('/sso/callback')) {
      // An organization's own provider may bring its people in, but its word about an email
      // address proves nothing: the account starts out unverified.
      return { data: { emailVerified: false } }
    }
    if (isSsoPath(context?.path)) {
      const allowed = mayCreateSsoAccount({
        trusted: isTrusted(options.sso, ssoProviderOf(context)),
        emailVerified: user.emailVerified,
        invited: await hasPendingInvitation(options.db, email),
        onVerifiedDomain: (await organizationsForEmailDomain(options.db, email)).length > 0,
      })
      // `code` makes better-auth's callback redirect to the error URL (`?error=<code>`) so the
      // sign-in page can say so; without one the browser would be left on a bare 403.
      if (!allowed) {
        throw new APIError('FORBIDDEN', {
          message: 'No account for this address',
          code: 'no_account_for_address',
        })
      }
      return undefined
    }
    if (context?.path !== '/sign-in/email-otp') return undefined
    if (
      !(await hasPendingInvitation(options.db, email)) &&
      (await organizationsForEmailDomain(options.db, email)).length === 0
    ) {
      throw new APIError('FORBIDDEN', { message: 'No account for this address' })
    }
    // A code proves the address, not a name: better-auth would store an empty one, which leaves
    // the account menu and member lists blank. Use the part before the @ until they set one.
    if (typeof user.name !== 'string' || user.name.trim() === '') {
      return { data: { name: email.split('@')[0] ?? email } }
    }
    return undefined
  }
}
