export { type Auth, createAuth } from './auth.ts'
export {
  CI_KEY_CONFIG,
  CI_KEY_PREFIX,
  EMAIL_CODE_TTL_SECONDS,
  INVITATION_TTL_SECONDS,
  MIN_PASSWORD_LENGTH,
} from './constants.ts'
export { hasPendingInvitation } from './operations/accounts.ts'
export type { AuthOptions } from './options.ts'
export { authPlugins } from './plugins/index.ts'

export { createSmtpMailer, type Mailer, signInMail, invitationMail } from './mail.ts'

export {
  addMember,
  createOrganization,
  createProjectWithToken,
  createUser,
  generatePassword,
  type IssuedToken,
  rotateProjectToken,
  setUserPassword,
  verifyProjectToken,
} from './operations/admin.ts'

export { isAPIError as isAuthApiError } from 'better-auth/api'
export { fromNodeHeaders } from 'better-auth/node'
export { isSetupCode, setupCode } from './operations/setup.ts'
export { withTrustedIssuer } from './sso/trusted-issuers.ts'
export { callbackUrl, type SsoProvider } from './sso/sso.ts'
