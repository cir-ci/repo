/**
 * What `connect` (and an OAuth exchange) throws, so the generic route can answer without knowing
 * the provider: `InvalidCredentialsError` is the person's to fix, `IntegrationUnreachableError`
 * is the provider being down or confused (502), `IntegrationConflictError` is an account another
 * workspace of this instance already uses (409). Anything else is a bug and answers 500.
 */

export type IntegrationErrorCode =
  | 'invalid_credentials'
  | 'unreachable'
  | 'conflict'
  | 'invalid_input'
  | 'not_found'

export class IntegrationError extends Error {
  /** What went wrong, for whoever maps it to a response (the server keeps the one table). */
  readonly code: IntegrationErrorCode
  constructor(code: IntegrationErrorCode, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = new.target.name
    this.code = code
  }
}

/** The provider refused the credentials (wrong token, no access). The message is shown to the person. */
export class InvalidCredentialsError extends IntegrationError {
  constructor(message: string, options?: ErrorOptions) {
    super('invalid_credentials', message, options)
  }
}

/** The provider did not answer sensibly; trying again may help. */
export class IntegrationUnreachableError extends IntegrationError {
  constructor(message: string, options?: ErrorOptions) {
    super('unreachable', message, options)
  }
}

/** The account is already connected, here or elsewhere. */
export class IntegrationConflictError extends IntegrationError {
  constructor(message: string, options?: ErrorOptions) {
    super('conflict', message, options)
  }
}

/** What a person typed cannot be used (not an address of this provider); the message says why. */
export class InvalidInputError extends IntegrationError {
  constructor(message: string, options?: ErrorOptions) {
    super('invalid_input', message, options)
  }
}

/** What was named does not exist on the provider (a GitHub App installation id nobody installed). */
export class IntegrationNotFoundError extends IntegrationError {
  constructor(message: string, options?: ErrorOptions) {
    super('not_found', message, options)
  }
}
