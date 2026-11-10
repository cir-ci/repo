import { afterAll, describe, expect, it } from 'vitest'

import { startDashboard } from '#test/support/dashboard-fixture.ts'

const fx = await startDashboard()
const { acme, acmeCookie, get } = fx
afterAll(() => fx.close())

describe('web app', () => {
  it('serves the app shell to everyone, so it can show the sign-in page', async () => {
    const res = await get(`/${acme.workspaceSlug}/web/builds/2`, '')
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('id="root"')
    expect(res.headers['cache-control']).toBe('no-cache')
  })

  it('caches hashed assets for good', async () => {
    const res = await get('/assets/app-1a2b3c.js', '')
    expect(res.statusCode).toBe(200)
    expect(res.headers['cache-control']).toBe('public, max-age=31536000, immutable')
  })

  it('serves the installable app: the manifest as its own type, the service worker never cached', async () => {
    const manifest = await get('/manifest.webmanifest', '')
    expect(manifest.statusCode).toBe(200)
    expect(manifest.headers['content-type']).toContain('application/manifest+json')
    expect(manifest.headers['cache-control']).toBe('no-cache')
    const worker = await get('/sw.js', '')
    expect(worker.statusCode).toBe(200)
    expect(worker.headers['content-type']).toMatch(/javascript/)
    expect(worker.headers['cache-control']).toBe('no-store')
    // Not the app shell: the worker is a file at the root.
    expect(worker.body).not.toContain('id="root"')
  })

  it('answers unknown API paths with JSON 404s, not the app shell', async () => {
    const res = await get('/api/nope', acmeCookie)
    expect(res.statusCode).toBe(404)
    expect(res.json()).toEqual({ error: 'Not found' })
  })
})
