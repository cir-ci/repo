export class ConflictError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConflictError'
  }
}

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NotFoundError'
  }
}

/** Postgres SQLSTATE, whether the driver error is thrown directly or wrapped by drizzle. */
export function pgErrorCode(err: unknown): string | undefined {
  let current: unknown = err
  for (let depth = 0; depth < 5 && current; depth++) {
    const code = (current as { code?: unknown }).code
    if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) return code
    current = (current as { cause?: unknown }).cause
  }
  return undefined
}

export const isUniqueViolation = (err: unknown) => pgErrorCode(err) === '23505'
