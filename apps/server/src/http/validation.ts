import { ValidationError } from '@circi/core'
import type { z } from 'zod'

/** Parses request input with a zod schema; failures become a 400 listing every problem. */
export function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value)
  if (!result.success) {
    throw new ValidationError(
      result.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; '),
    )
  }
  return result.data
}
