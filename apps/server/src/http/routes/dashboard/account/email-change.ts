import type { Account } from '@circi/api'
import { getPendingEmailChange } from '@circi/db/queries'
import type { FastifyPluginAsync } from 'fastify'

import { currentUser } from '#http/hooks/session.ts'
import type { Deps } from '#http/lib/deps.ts'

/**
 * `/api/account/email-change`: whether the signed-in person's change of email address is waiting
 * for its confirmation link. Asking for the change and confirming it are better-auth's
 * `/api/auth/change-email` and the link it mails (see `hooks/email-change.ts` in `@circi/auth`).
 */
export const dashboardAccountEmailRoutes: FastifyPluginAsync<Deps.Dashboard> = async (
  app,
  deps,
) => {
  app.get('/account/email-change', async (req): Promise<Account.EmailChange> => {
    return { pendingEmail: await getPendingEmailChange(deps.db, currentUser(req).id) }
  })
}
