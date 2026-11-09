import { ValidationError } from '@circi/core'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { parse } from '#http/lib/validation.ts'

const schema = z.object({
  name: z.string().min(1).max(5),
  defaultBranch: z.string(),
  email: z.email().optional(),
  count: z.number().max(10).optional(),
})

function failure(value: unknown): ValidationError {
  try {
    parse(schema, value)
  } catch (err) {
    if (err instanceof ValidationError) return err
    throw err
  }
  throw new Error('expected a failure')
}

describe('parse', () => {
  it('says what is wrong in plain words, and keys each message by field', () => {
    const err = failure({ name: '', email: 'x', count: 11 })
    expect(err.message).not.toMatch(/expected|>=|Too small|Invalid input/)
    expect(err.fields).toEqual({
      name: "Name can't be blank",
      defaultBranch: 'Default branch is required',
      email: 'Email must be a valid email address',
      count: 'Count must be at most 10',
    })
    expect(failure({ name: 'abcdefg', defaultBranch: 'main' }).message).toBe(
      'Name must be 5 characters or fewer',
    )
  })

  it('returns the data when it is valid', () => {
    expect(parse(schema, { name: 'ab', defaultBranch: 'main' })).toEqual({
      name: 'ab',
      defaultBranch: 'main',
    })
  })
})
