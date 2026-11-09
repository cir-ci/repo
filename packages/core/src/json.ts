/** Narrowing for JSON that came from outside (an API answer, a webhook body): never throws. */

/** A plain object (not an array, not null). */
export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** The object's fields as a record; `{}` for anything that is not a plain object. */
export const asRecord = (value: unknown): Record<string, unknown> =>
  isRecord(value) ? Object.fromEntries(Object.entries(value)) : {}

/** The value when it is a string, else `fallback`. */
export const str = (value: unknown, fallback = ''): string =>
  typeof value === 'string' ? value : fallback

/** The value when it is an array, else an empty one. */
export const items = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])
