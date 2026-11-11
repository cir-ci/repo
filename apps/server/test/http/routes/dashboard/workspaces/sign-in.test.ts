import { afterAll, describe, expect, it } from 'vitest'

import { startDashboard } from '#test/support/dashboard-fixture.ts'
import { ORIGIN, signIn } from '#test/support/helpers.ts'

const fx = await startDashboard()
const { app, acme, acmeCookie, get } = fx
afterAll(() => fx.close())

describe('signing in', () => {
  it('needs a session for the dashboard API', async () => {
    const res = await get('/api/projects', '')
    expect(res.statusCode).toBe(401)
    expect(res.json()).toEqual({ error: 'Sign in to continue' })
  })

  it('signs in with email and password, and the cookie works', async () => {
    const res = await get('/api/projects', acmeCookie)
    expect(res.statusCode).toBe(200)
  })

  it('sets a __Host- session cookie: Secure, HttpOnly, no Domain, Path=/', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-in/email',
      headers: { origin: ORIGIN, 'content-type': 'application/json' },
      payload: { email: acme.owner.email, password: acme.owner.password },
    })
    const cookies = [res.headers['set-cookie']]
      .flat()
      .filter((c): c is string => typeof c === 'string')
    const session = cookies.find((c) => c.startsWith('__Host-circi.session_token='))
    expect(session).toBeDefined()
    expect(session).toMatch(/;\s*Secure/i)
    expect(session).toMatch(/;\s*HttpOnly/i)
    expect(session).toMatch(/;\s*Path=\//i)
    expect(session).not.toMatch(/;\s*Domain=/i)
    // Every cookie better-auth sets must qualify for the prefix, or browsers drop it.
    for (const c of cookies) expect(c.startsWith('__Host-')).toBe(true)
  })

  it('refuses a wrong password', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-in/email',
      headers: { origin: ORIGIN, 'content-type': 'application/json' },
      payload: { email: acme.owner.email, password: 'definitely-the-wrong-one' },
    })
    expect(res.statusCode).toBe(401)
    expect(res.headers['set-cookie']).toBeUndefined()
  })

  it('has no self sign-up: accounts come from the admin CLI', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-up/email',
      headers: { origin: ORIGIN, 'content-type': 'application/json' },
      payload: {
        email: 'stranger@example.com',
        name: 'Stranger',
        password: 'a-very-long-password-1',
      },
    })
    expect(res.statusCode).toBeGreaterThanOrEqual(400)
    const projects = await get('/api/projects', '')
    expect(projects.statusCode).toBe(401)
  })

  it('reports who is signed in, and nobody when signed out', async () => {
    const me = await app.inject({
      method: 'GET',
      url: '/api/auth/get-session',
      headers: { cookie: acmeCookie },
    })
    expect(me.json()).toMatchObject({ user: { email: acme.owner.email } })
    const nobody = await app.inject({ method: 'GET', url: '/api/auth/get-session' })
    expect(nobody.json()).toBeNull()
  })

  it('stops working after signing out', async () => {
    const cookie = await signIn(app, acme.owner.email, acme.owner.password)
    expect((await get('/api/projects', cookie)).statusCode).toBe(200)
    const out = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-out',
      headers: { origin: ORIGIN, cookie, 'content-type': 'application/json' },
      payload: {},
    })
    expect(out.statusCode).toBe(200)
    expect((await get('/api/projects', cookie)).statusCode).toBe(401)
  })

  it('does not accept a CI token as a dashboard session', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/projects',
      headers: { authorization: `Bearer ${acme.token}` },
    })
    expect(res.statusCode).toBe(401)
  })
})
