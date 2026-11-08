import { describe, expect, it } from 'vitest'

import {
  describeCodeFailure,
  describeFailure,
  readInvitedEmail,
  readLink,
  ssoErrorMessage,
  text,
  withoutSignInLink,
} from '#features/auth/login-helpers.ts'

describe('readLink', () => {
  it('reads the email and code from the fragment of the mailed link', () => {
    expect(readLink('#signin-email=ada%40example.com&code=123456')).toEqual({
      email: 'ada@example.com',
      code: '123456',
    })
  })

  it.each(['', '#signin-email=ada@example.com', '#code=123456'])(
    'is undefined unless both are there (%j)',
    (hash) => {
      expect(readLink(hash)).toBeUndefined()
    },
  )
})

describe('readInvitedEmail', () => {
  it('reads the invited address of an invitation link', () => {
    expect(readInvitedEmail('#invite=abc&email=ada%40example.com')).toBe('ada@example.com')
  })

  it('is undefined without an invitation, or without an address', () => {
    expect(readInvitedEmail('#email=ada@example.com')).toBeUndefined()
    expect(readInvitedEmail('#invite=abc')).toBeUndefined()
  })
})

describe('text', () => {
  it('is the field’s string, or empty for a missing field or a file', () => {
    const form = new FormData()
    form.set('a', 'hello')
    form.set('f', new File(['x'], 'x.txt'))
    expect(text(form, 'a')).toBe('hello')
    expect(text(form, 'f')).toBe('')
    expect(text(form, 'nope')).toBe('')
  })
})

describe('describeFailure', () => {
  it('does not say whether the email or the password was wrong', () => {
    expect(describeFailure(401)).toBe('Incorrect email or password.')
    expect(describeFailure(400)).toBe(describeFailure(401))
  })

  it('names rate limiting and treats the rest as a connection problem', () => {
    expect(describeFailure(429)).toMatch(/Too many attempts/)
    expect(describeFailure(500)).toMatch(/Check your connection/)
  })
})

describe('describeCodeFailure', () => {
  it.each([400, 401, 403])('says the code is wrong or expired for %i', (status) => {
    expect(describeCodeFailure(status)).toMatch(/wrong or has expired/)
  })

  it('names rate limiting and treats the rest as a connection problem', () => {
    expect(describeCodeFailure(429)).toMatch(/Too many attempts/)
    expect(describeCodeFailure(502)).toMatch(/Check your connection/)
  })
})

describe('ssoErrorMessage', () => {
  it('is undefined without an error', () => {
    expect(ssoErrorMessage('')).toBeUndefined()
    expect(ssoErrorMessage('?other=1')).toBeUndefined()
  })

  it('explains an account-linking refusal separately from any other failure', () => {
    expect(ssoErrorMessage('?error=account_not_linked')).toMatch(/isn’t trusted to attach/)
    expect(ssoErrorMessage('?error=access_denied')).toMatch(/didn’t work/)
  })
})

describe('withoutSignInLink', () => {
  it('drops the mailed link’s address and code', () => {
    expect(withoutSignInLink('#signin-email=ada%40example.com&code=123456')).toBe('')
  })

  it('keeps an invitation, which is read again after signing in', () => {
    expect(withoutSignInLink('#invite=abc&email=ada%40example.com')).toBe(
      '#invite=abc&email=ada%40example.com',
    )
    expect(withoutSignInLink('#invite=abc&email=a%40b.test&code=123456')).toBe(
      '#invite=abc&email=a%40b.test',
    )
  })
})
