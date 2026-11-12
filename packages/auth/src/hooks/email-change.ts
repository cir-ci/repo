import { emailChangeIdentifier, getAccountEmail, isEmailTaken } from '@circi/db/queries'
import { APIError, getSessionFromCtx } from 'better-auth/api'
import type { createAuthMiddleware } from 'better-auth/api'

import { confirmNewEmailMail, emailChangeRequestedMail } from '#src/mail.ts'
import type { AuthOptions } from '#src/options.ts'

import { joinByVerifiedDomain } from './session-created.ts'

/** How long a confirmation link works: better-auth's default, which the pending note follows. */
export const EMAIL_CHANGE_TTL_SECONDS = 60 * 60

/**
 * The little of better-auth's internal adapter these hooks write through (the verification
 * table is better-auth's). `createAuth` fills the holder with `auth.$context` once the instance
 * exists, since the hooks are part of building it.
 */
export interface AuthContextHolder {
  context?: Promise<{
    internalAdapter: {
      createVerificationValue(data: {
        identifier: string
        value: string
        expiresAt: Date
      }): Promise<unknown>
      deleteVerificationByIdentifier(identifier: string): Promise<unknown>
    }
  }>
}

type Ctx = Parameters<Parameters<typeof createAuthMiddleware>[0]>[0]

/**
 * Before `/change-email` and the confirmation link:
 *
 * - without mail nobody can confirm a new address, so the request is refused (an instance admin
 *   changes it instead);
 * - an address another account uses is refused with its own message. better-auth answers 200 to
 *   hide which addresses exist; here the person is signed in and the field needs to say why, and
 *   anyone who can ask is already inside the instance;
 * - the confirmation link needs the signed-in browser: better-auth would otherwise sign in whoever
 *   opens it, with no password or code. Without a session the link lands on the sign-in page.
 */
export async function guardEmailChange(
  options: Pick<AuthOptions, 'db' | 'mailer'>,
  ctx: Ctx,
): Promise<void> {
  if (ctx.path === '/verify-email') {
    if (!(await getSessionFromCtx(ctx))) throw ctx.redirect('/')
    return
  }
  if (ctx.path !== '/change-email') return
  if (!options.mailer || (await options.mailer.configured?.()) === false) {
    throw new APIError('BAD_REQUEST', {
      message: "This instance can't send email, so an instance admin has to change it",
      code: 'EMAIL_CHANGE_NEEDS_MAIL',
    })
  }
  const session = await getSessionFromCtx(ctx)
  const requested: unknown = ctx.body?.newEmail
  if (
    session &&
    typeof requested === 'string' &&
    (await isEmailTaken(options.db, requested, session.user.id))
  ) {
    throw new APIError('BAD_REQUEST', {
      message: 'That email address is already in use',
      code: 'EMAIL_IN_USE',
    })
  }
}

/**
 * better-auth's verification mail for a changed address: `user` carries the NEW address, and the
 * account still has the old one. The link goes to the new address; the old one is told that a
 * change was requested (and nothing has changed yet); the request is remembered so the profile
 * can say it is waiting. Mail is never awaited, so its latency says nothing.
 */
export function sendEmailChangeMails(options: AuthOptions, holder: AuthContextHolder) {
  return async (data: { user: { id: string; name: string; email: string }; url: string }) => {
    const { mailer } = options
    if (!mailer) return
    const newEmail = data.user.email
    const currentEmail = await getAccountEmail(options.db, data.user.id)
    const failed = (err: unknown) => options.onMailError?.(err)
    if (currentEmail === undefined || currentEmail.toLowerCase() === newEmail.toLowerCase()) {
      return
    }
    const adapter = (await holder.context)?.internalAdapter
    const key = emailChangeIdentifier(data.user.id)
    await adapter?.deleteVerificationByIdentifier(key)
    await adapter?.createVerificationValue({
      identifier: key,
      value: newEmail,
      expiresAt: new Date(Date.now() + EMAIL_CHANGE_TTL_SECONDS * 1000),
    })
    void mailer
      .send(
        confirmNewEmailMail({
          to: newEmail,
          name: data.user.name,
          currentEmail,
          link: data.url,
        }),
      )
      .catch(failed)
    void mailer
      .send(
        emailChangeRequestedMail({
          to: currentEmail,
          name: data.user.name,
          newEmail,
          origin: options.baseURL,
        }),
      )
      .catch(failed)
  }
}

/**
 * After an account's address changed (the new one was confirmed from its mailbox, or an instance
 * admin set it): the pending note goes, and the person is added to every workspace that verified
 * the new address's domain.
 *
 * Domain auto-join is decided like at sign-in: it only ever adds. Someone who moves from
 * `old.com` to `new.com` keeps every membership they have, including those that came from
 * `old.com` (a seat in a workspace is the workspace's decision, not a property of the address;
 * owners and admins remove people), and joins workspaces that verified `new.com`. The address
 * counts as proven, either by the confirmation mail or because an instance admin vouches for it,
 * so a workspace's domain claim may take them in, as with an emailed sign-in code.
 */
export async function afterEmailChanged(
  options: Pick<AuthOptions, 'db'>,
  holder: AuthContextHolder,
  userId: string,
): Promise<void> {
  await (
    await holder.context
  )?.internalAdapter.deleteVerificationByIdentifier(emailChangeIdentifier(userId))
  await joinByVerifiedDomain(options.db, userId, { requireVerifiedEmail: true })
}
