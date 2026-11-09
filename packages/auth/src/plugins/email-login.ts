import { workspacesForEmailDomain } from '@circi/db/repositories'
import { emailOTP } from 'better-auth/plugins'

import { hasAccount, hasPendingInvitation } from '#operations/accounts.ts'
import { EMAIL_CODE_TTL_SECONDS } from '#src/constants.ts'
import { signInMail } from '#src/mail.ts'
import type { PluginOptions } from '#src/options.ts'

/**
 * Email login (PLAN §7.8): a 6-digit code, mailed together with a link that opens the sign-in
 * page with the code filled in (in the URL fragment, so servers and proxies never see it). The
 * page still needs a click, so mail scanners that open links can't use the code up.
 * Unknown addresses get no mail and the same answer (`disableSignUp`).
 */
export function emailLoginPlugin(options: PluginOptions) {
  return emailOTP({
    otpLength: 6,
    expiresIn: EMAIL_CODE_TTL_SECONDS,
    allowedAttempts: 5,
    storeOTP: 'hashed',
    // Signing in with a code creates the account of someone who was invited (the code proves
    // they own the address); for anyone else no mail is sent, and `databaseHooks` in
    // `createAuth` refuses to create the account anyway.
    disableSignUp: false,
    // Not awaited: waiting for the mail server would show which addresses have accounts.
    sendVerificationOTP: async ({ email, otp, type }) => {
      if (type !== 'sign-in' || !options.mailer || !options.baseURL || !options.db) return
      if (
        !(await hasAccount(options.db, email)) &&
        !(await hasPendingInvitation(options.db, email)) &&
        (await workspacesForEmailDomain(options.db, email)).length === 0
      ) {
        return
      }
      void options.mailer
        .send(signInMail(email, otp, options.baseURL))
        .catch((err: unknown) => options.onMailError?.(err))
    },
  })
}
