import { describe, expect, it } from 'vitest'

import { describeAuthValidation } from '#src/index.ts'

describe('describeAuthValidation', () => {
  it('says a missing field is required, keyed by the field', () => {
    expect(
      describeAuthValidation('[body.email] Invalid input: expected string, received undefined'),
    ).toEqual({ error: 'Email is required', fields: { email: 'Email is required' } })
  })

  it('handles several problems, camelCase names and length rules', () => {
    expect(
      describeAuthValidation(
        '[body.currentPassword] Invalid input: expected string, received undefined; [body.newPassword] Too small: expected string to have >=8 characters',
      ),
    ).toEqual({
      error: 'Current password is required; New password must be at least 8 characters',
      fields: {
        currentPassword: 'Current password is required',
        newPassword: 'New password must be at least 8 characters',
      },
    })
  })

  it('names a bad email and a missing body', () => {
    expect(describeAuthValidation('[body.email] Invalid email address')?.error).toBe(
      'Email must be a valid email address',
    )
    expect(
      describeAuthValidation('[body] Invalid input: expected object, received undefined')?.fields,
    ).toEqual({ body: 'The request needs a valid body' })
  })

  it('leaves other text alone', () => {
    expect(describeAuthValidation('Invalid email or password')).toBeUndefined()
  })
})
