import { afterAll, describe, expect, it } from 'vitest'

import { JSON_HEADERS } from '#test/support/client.ts'
import { startDashboard } from '#test/support/dashboard-fixture.ts'

const fx = await startDashboard()
const { acme, acmeCookie } = fx
afterAll(() => fx.close())

const post = (url: string, payload: unknown, cookie = acmeCookie) =>
  fx.app.inject({
    method: 'POST',
    url,
    headers: { ...JSON_HEADERS, cookie },
    payload: JSON.stringify(payload),
  })

describe('account picture address', () => {
  it.each([
    'javascript:alert(1)',
    'data:text/html;base64,AAAA',
    'ftp://example.com/a.png',
    `https://example.com/${'a'.repeat(2100)}`,
    'not a url',
  ])('refuses %s', async (image) => {
    const res = await post('/api/auth/update-user', { image })
    expect(res.statusCode).toBe(400)
    expect(res.json().message).toMatch(/picture address/i)
  })

  it('accepts an http(s) address, one of our own paths, and none', async () => {
    for (const image of ['https://example.com/me.png', 'http://example.com/me.png', '/api/x']) {
      // oxlint-disable-next-line no-await-in-loop -- tiny fixed list
      expect((await post('/api/auth/update-user', { image })).statusCode).toBe(200)
    }
  })
})

describe('changing a password', () => {
  it('refuses the same password again, and says why', async () => {
    const res = await post('/api/auth/change-password', {
      currentPassword: acme.owner.password,
      newPassword: acme.owner.password,
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().message).toBe('The new password must be different from the current one.')
  })
})

describe('malformed bodies on /api/auth', () => {
  it("answer in human, field-keyed words, with better-auth's code kept", async () => {
    const signIn = await post('/api/auth/sign-in/email', {}, '')
    expect(signIn.statusCode).toBe(400)
    expect(signIn.json()).toMatchObject({
      code: 'VALIDATION_ERROR',
      error: 'Email is required; Password is required',
      message: 'Email is required; Password is required',
      fields: { email: 'Email is required', password: 'Password is required' },
    })
    const change = await post('/api/auth/change-password', {})
    expect(change.json().fields).toEqual({
      newPassword: 'New password is required',
      currentPassword: 'Current password is required',
    })
    const invite = await post('/api/auth/organization/invite-member', {})
    expect(invite.statusCode).toBe(400)
    expect(JSON.stringify(invite.json())).not.toMatch(/Invalid input|\[body/)
  })

  it('leaves successful and other responses alone', async () => {
    const res = await fx.get('/api/auth/get-session', acmeCookie)
    expect(res.statusCode).toBe(200)
    expect(res.json().user.email).toBe(acme.owner.email)
  })
})
