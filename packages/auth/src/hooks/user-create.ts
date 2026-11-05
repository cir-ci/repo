import { organizationsForEmailDomain } from '@circi/db'
import { APIError } from 'better-auth/api'

import { hasPendingInvitation } from '../accounts.ts'
import type { AuthOptions } from '../options.ts'
import { isSsoPath, isTrusted, mayCreateSsoAccount, ssoProviderOf } from '../sso.ts'

/**
 * Accounts are never created by self sign-up. Only an email-code sign-in may create one on its
 * own, for invitees and for people on a domain some organization has verified; single sign-on
 * follows the stricter rules in `mayCreateSsoAccount`.
 */
export function beforeUserCreate(options: Pick<AuthOptions, 'db' | 'sso'>) {
  return async (
    user: { email?: unknown; emailVerified: boolean },
    context: { path?: string; params?: unknown } | null,
  ) => {
    const email = typeof user.email === 'string' ? user.email : ''
    if (isSsoPath(context?.path)) {
      const allowed = mayCreateSsoAccount({
        trusted: isTrusted(options.sso, ssoProviderOf(context)),
        emailVerified: user.emailVerified,
        invited: await hasPendingInvitation(options.db, email),
        onVerifiedDomain: (await organizationsForEmailDomain(options.db, email)).length > 0,
      })
      if (!allowed) throw new APIError('FORBIDDEN', { message: 'No account for this address' })
      return
    }
    if (context?.path !== '/sign-in/email-otp') return
    if (
      !(await hasPendingInvitation(options.db, email)) &&
      (await organizationsForEmailDomain(options.db, email)).length === 0
    ) {
      throw new APIError('FORBIDDEN', { message: 'No account for this address' })
    }
  }
}
