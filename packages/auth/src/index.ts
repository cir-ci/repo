export { type Auth, createAuth } from './auth.ts'
export {
  CI_KEY_CONFIG,
  CI_KEY_PREFIX,
  EMAIL_CODE_TTL_SECONDS,
  INVITATION_TTL_SECONDS,
  MIN_PASSWORD_LENGTH,
} from './constants.ts'
export { hasPendingInvitation } from './accounts.ts'
export type { AuthOptions } from './options.ts'
export { authPlugins } from './plugins/index.ts'

export {
  createSmtpMailer,
  type Mail,
  type Mailer,
  type SmtpOptions,
  signInMail,
  invitationMail,
} from './mail.ts'

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
} from './admin.ts'

export { isAPIError as isAuthApiError } from 'better-auth/api'
export { fromNodeHeaders } from 'better-auth/node'
export { isSetupCode, setupCode } from './setup.ts'
export { withTrustedIssuer } from './trusted-issuers.ts'
export { callbackUrl, type SsoProvider } from './sso.ts'
