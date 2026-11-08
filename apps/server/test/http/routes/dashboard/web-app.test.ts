import { afterAll, describe, expect, it } from 'vitest'

import { startDashboard } from '../../../support/dashboard-fixture.ts'

const fx = await startDashboard()
const { acme, acmeCookie, get } = fx
afterAll(() => fx.close())

describe('web app', () => {
  it('serves the app shell to everyone, so it can show the sign-in page', async () => {
    const res = await get(`/${acme.orgSlug}/web/builds/2`, '')
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('id="root"')
    expect(res.headers['cache-control']).toBe('no-cache')
  })

  it('caches hashed assets for good', async () => {
    const res = await get('/assets/app-1a2b3c.js', '')
    expect(res.statusCode).toBe(200)
    expect(res.headers['cache-control']).toBe('public, max-age=31536000, immutable')
  })

  it('answers unknown API paths with JSON 404s, not the app shell', async () => {
    const res = await get('/api/nope', acmeCookie)
    expect(res.statusCode).toBe(404)
    expect(res.json()).toEqual({ error: 'Not found' })
  })
})
