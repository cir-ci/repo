import { ACCOUNT_NAME_MAX, accountImageProblem, accountNameProblem } from '@circi/core'
import { workspacesForEmailDomain } from '@circi/db/repositories'
import { APIError } from 'better-auth/api'

import { hasPendingInvitation } from '#operations/accounts.ts'
import { isSsoPath, isTrusted, mayCreateSsoAccount, ssoProviderOf } from '#plugins/sso/sso.ts'
import type { AuthOptions } from '#src/options.ts'

/**
 * Accounts are never created by self sign-up. Only an email-code sign-in may create one on its
 * own, for invitees and for people on a domain some workspace has verified; single sign-on
 * follows the stricter rules in `mayCreateSsoAccount`.
 */
export function beforeUserCreate(options: Pick<AuthOptions, 'db' | 'sso'>) {
  const create = beforeUserCreateRules(options)
  return async (
    user: { email?: unknown; name?: unknown; emailVerified: boolean },
    context: { path?: string; params?: unknown } | null,
  ): Promise<{ data: { emailVerified?: boolean; name?: string } } | undefined> => {
    // A name that comes with a login (a provider's, or none at all) is tidied rather than
    // refused, or the person could not sign in; one somebody typed must pass the name rule.
    const lenient =
      isSsoPath(context?.path) ||
      context?.path?.startsWith('/sso/callback') === true ||
      context?.path === '/sign-in/email-otp'
    let tidy: string | undefined
    if (typeof user.name === 'string') {
      if (lenient) {
        tidy = Array.from(user.name.trim()).slice(0, ACCOUNT_NAME_MAX).join('')
      } else {
        assertAccountName(user.name)
        tidy = user.name.trim()
      }
    }
    const result = await create(user, context)
    if (
      tidy === undefined ||
      tidy === '' ||
      tidy === user.name ||
      result?.data.name !== undefined
    ) {
      return result
    }
    return { data: { ...result?.data, name: tidy } }
  }
}

/** Refuses a name that breaks the account name rule (400, with the rule's message). */
export function assertAccountName(name: string): void {
  const problem = accountNameProblem(name)
  if (problem) throw new APIError('BAD_REQUEST', { message: problem })
}

/** The same rule for a name being changed (the person's own, or an admin's), and one for the picture address. */
export function beforeUserUpdate() {
  return async (
    user: { name?: unknown; image?: unknown },
    context?: { path?: string } | null,
  ): Promise<{ data: { name: string } } | undefined> => {
    // Only what somebody typed: a provider's own picture, refreshed at sign-in, must not block it.
    if (typeof user.image === 'string' && context?.path?.endsWith('update-user')) {
      const problem = accountImageProblem(user.image)
      if (problem) throw new APIError('BAD_REQUEST', { message: problem })
    }
    if (typeof user.name !== 'string') return undefined
    assertAccountName(user.name)
    return { data: { name: user.name.trim() } }
  }
}

function beforeUserCreateRules(options: Pick<AuthOptions, 'db' | 'sso'>) {
  return async (
    user: { email?: unknown; name?: unknown; emailVerified: boolean },
    context: { path?: string; params?: unknown } | null,
  ): Promise<{ data: { emailVerified?: boolean; name?: string } } | undefined> => {
    const email = typeof user.email === 'string' ? user.email : ''
    if (context?.path?.startsWith('/sso/callback')) {
      // A workspace's own provider may bring its people in, but its word about an email
      // address proves nothing: the account starts out unverified.
      return { data: { emailVerified: false } }
    }
    if (isSsoPath(context?.path)) {
      const allowed = mayCreateSsoAccount({
        trusted: isTrusted(options.sso, ssoProviderOf(context)),
        emailVerified: user.emailVerified,
        invited: await hasPendingInvitation(options.db, email),
        onVerifiedDomain: (await workspacesForEmailDomain(options.db, email)).length > 0,
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
      (await workspacesForEmailDomain(options.db, email)).length === 0
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
