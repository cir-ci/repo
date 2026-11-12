import { afterAll, describe, expect, it } from 'vitest'

import { startDashboard } from '#test/support/dashboard-fixture.ts'
import { ORIGIN } from '#test/support/helpers.ts'

const fx = await startDashboard()
const { acmeCookie } = fx
afterAll(() => fx.close())

const rename = (name: unknown) =>
  fx.app.inject({
    method: 'POST',
    url: '/api/auth/update-user',
    headers: { origin: ORIGIN, 'content-type': 'application/json', cookie: acmeCookie },
    payload: { name },
  })

describe('account names', () => {
  it('refuses blank and oversized names, with a message that says why', async () => {
    for (const [name, message] of [
      ['', /Enter a name/],
      ['   ', /Enter a name/],
      ['x'.repeat(500), /100 characters or fewer/],
    ] as const) {
      // oxlint-disable-next-line no-await-in-loop -- tiny fixed list
      const res = await rename(name)
      expect(res.statusCode).toBe(400)
      expect(res.json().message).toMatch(message)
    }
  })

  it('stores a name trimmed', async () => {
    expect((await rename('  Ada Lovelace  ')).statusCode).toBe(200)
    const me = await fx.get('/api/auth/get-session?disableCookieCache=true', acmeCookie)
    expect(me.json().user.name).toBe('Ada Lovelace')
  })
})
