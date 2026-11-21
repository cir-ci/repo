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
export class ValidationError extends DomainError {
  /** Messages by field (dotted path), when the problem is in named fields of the request. */
  readonly fields: Readonly<Record<string, string>> | undefined

  constructor(
    message: string,
    options?: ErrorOptions & { fields?: Readonly<Record<string, string>> },
  ) {
    super(message, options)
    this.fields = options?.fields
  }
}

/** What was asked for does not exist (or is not visible to the caller). */
export class NotFoundError extends DomainError {}

/** The request clashes with the current state (a name already taken, a finished build). */
export class ConflictError extends DomainError {}

/** The caller is known but may not do this (e.g. editing someone else's comment). */
export class ForbiddenError extends DomainError {}

/** The `code` an error carries (Node's `ENOENT`, `ECONNREFUSED`, ...), or undefined. */
export function errorCode(err: unknown): string | undefined {
  return err instanceof Error && 'code' in err && typeof err.code === 'string'
    ? err.code
    : undefined
}

/** Throws `NotFoundError(message)` when a lookup or an update found nothing (`undefined`, `null`, `false`). */
export function assertFound<T>(value: T, message: string): asserts value is NonNullable<T> {
  if (!value) throw new NotFoundError(message)
}
