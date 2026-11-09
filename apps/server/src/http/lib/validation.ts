import { ValidationError } from '@circi/core'
import type { z } from 'zod'

/** "defaultBranch" as "Default branch"; the last named step of the path is the field. */
function fieldLabel(path: readonly PropertyKey[]): { key: string; label: string } {
  const key = path.map(String).join('.')
  const last = path.toReversed().find((step) => typeof step === 'string')
  if (typeof last !== 'string') return { key: key || 'body', label: 'This' }
  const words = last
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .toLowerCase()
  return { key, label: words.charAt(0).toUpperCase() + words.slice(1) }
}

const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`

/** One human sentence for a zod issue (zod's own wording is for developers). */
function describeIssue(issue: z.core.$ZodIssue, label: string): string {
  switch (issue.code) {
    case 'too_small': {
      const min = Number(issue.minimum)
      if (issue.origin === 'string') {
        return min <= 1
          ? `${label} can't be blank`
          : `${label} must be at least ${plural(min, 'character')}`
      }
      if (issue.origin === 'array' || issue.origin === 'set') {
        return min <= 1
          ? `${label} needs at least one item`
          : `${label} needs at least ${min} items`
      }
      return `${label} must be ${issue.inclusive === false ? 'more than' : 'at least'} ${min}`
    }
    case 'too_big': {
      const max = Number(issue.maximum)
      if (issue.origin === 'string') {
        return `${label} must be ${plural(max, 'character')} or fewer`
      }
      if (issue.origin === 'array' || issue.origin === 'set') {
        return `${label} can have at most ${max} items`
      }
      return `${label} must be ${issue.inclusive === false ? 'less than' : 'at most'} ${max}`
    }
    case 'invalid_type':
      return /received (undefined|null)\b/.test(issue.message)
        ? `${label} is required`
        : `${label} isn't valid`
    case 'invalid_format':
      if (issue.format === 'email') return `${label} must be a valid email address`
      if (issue.format === 'url') return `${label} must be a valid web address`
      if (issue.format === 'uuid') return `${label} isn't a valid id`
      return `${label} isn't in the right format`
    case 'invalid_value':
      return `${label} isn't one of the allowed values`
    case 'unrecognized_keys':
      return `Unknown ${issue.keys.length === 1 ? 'field' : 'fields'}: ${issue.keys.join(', ')}`
    case 'custom':
      // Written by us, for people (a `.refine` message).
      return issue.message
    default:
      return `${label} isn't valid`
  }
}

/**
 * Parses request input with a zod schema; failures become a 400 whose message is plain English
 * ("Name can't be blank") and whose `fields` say which field each problem is about.
 */
export function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value)
  if (result.success) return result.data
  const fields: Record<string, string> = {}
  const messages: string[] = []
  for (const issue of result.error.issues) {
    const { key, label } = fieldLabel(issue.path)
    const sentence = describeIssue(issue, label)
    fields[key] ??= sentence
    messages.push(sentence)
  }
  throw new ValidationError(messages.join('; '), { fields })
}
