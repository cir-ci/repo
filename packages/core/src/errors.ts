/**
 * Errors every layer can throw and the HTTP layer maps to a status. One class definition each:
 * other packages re-export these, never redefine them, so `instanceof` holds everywhere.
 */
export class DomainError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = new.target.name
  }
}

/** Bad input from a user or client. Safe to show the message as-is. */
export class ValidationError extends DomainError {}

/** What was asked for does not exist (or is not visible to the caller). */
export class NotFoundError extends DomainError {}

/** The request clashes with the current state (a name already taken, a finished build). */
export class ConflictError extends DomainError {}

/** The caller is known but may not do this (e.g. editing someone else's comment). */
export class ForbiddenError extends DomainError {}
