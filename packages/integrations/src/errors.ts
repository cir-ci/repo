/**
 * What `connect` (and an OAuth exchange) throws, so the generic route can answer without knowing
 * the provider: `InvalidCredentialsError` is the person's to fix (400), `IntegrationUnreachableError`
 * is the provider being down or confused (502), `IntegrationConflictError` is an account another
 * organisation of this instance already uses (409). Anything else is a bug and answers 500.
 */

export class IntegrationError extends Error {
  /** The HTTP status the generic route answers with. */
  readonly status: 400 | 409 | 502
  constructor(status: 400 | 409 | 502, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = new.target.name
    this.status = status
  }
}

/** The provider refused the credentials (wrong token, no access). The message is shown to the person. */
export class InvalidCredentialsError extends IntegrationError {
  constructor(message: string, options?: ErrorOptions) {
    super(400, message, options)
  }
}

/** The provider did not answer sensibly; trying again may help. */
export class IntegrationUnreachableError extends IntegrationError {
  constructor(message: string, options?: ErrorOptions) {
    super(502, message, options)
  }
}

/** The account is already connected, here or elsewhere. */
export class IntegrationConflictError extends IntegrationError {
  constructor(message: string, options?: ErrorOptions) {
    super(409, message, options)
  }
}

/** What a person typed cannot be used (not an address of this provider); the message says why. */
export class InvalidInputError extends IntegrationError {
  constructor(message: string, options?: ErrorOptions) {
    super(400, message, options)
  }
}
