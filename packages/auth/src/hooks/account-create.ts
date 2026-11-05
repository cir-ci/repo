import { schema } from '@circi/db'
import { APIError } from 'better-auth/api'
import { eq } from 'drizzle-orm'

import type { AuthOptions } from '../options.ts'
import { isSsoPath, isTrusted, mayLinkSsoAccount } from '../sso.ts'

/**
 * A login with a provider the operator doesn't vouch for must not attach to an account that
 * already existed, even if the provider claims the email is verified.
 */
export function beforeAccountCreate(options: Pick<AuthOptions, 'db' | 'sso'>) {
  return async (
    created: { userId: string; providerId: string },
    context: { path?: string } | null,
  ) => {
    if (!isSsoPath(context?.path)) return
    const [owner] = await options.db
      .select({ createdAt: schema.user.createdAt })
      .from(schema.user)
      .where(eq(schema.user.id, created.userId))
    const accountAgeMs = owner ? Date.now() - owner.createdAt.getTime() : 0
    if (!mayLinkSsoAccount({ trusted: isTrusted(options.sso, created.providerId), accountAgeMs })) {
      throw new APIError('FORBIDDEN', {
        message: 'This sign-in provider is not trusted to link to an existing account',
      })
    }
  }
}
