import Fastify from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { requireSameOrigin } from '#http/hooks/same-origin.ts'

const ORIGIN = 'https://ci.acme.io'
const app = Fastify()

beforeAll(async () => {
  app.addHook('onRequest', requireSameOrigin(ORIGIN))
  app.get('/thing', () => 'ok')
  app.post('/thing', () => 'ok')
  await app.ready()
})
afterAll(() => app.close())

const post = (headers: Record<string, string>) =>
  app.inject({ method: 'POST', url: '/thing', headers })

describe('requireSameOrigin', () => {
  it('lets safe methods through whatever they claim', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/thing',
      headers: { origin: 'https://evil.example' },
    })
    expect(res.statusCode).toBe(200)
  })

  it('lets a change through from the dashboard origin', async () => {
    expect((await post({ origin: ORIGIN })).statusCode).toBe(200)
  })

  it('refuses a change from another origin, and says why', async () => {
    const res = await post({ origin: 'https://sb.example-sites.com' })
    expect(res.statusCode).toBe(403)
    expect(res.json()).toEqual({
      error: 'This request must come from the CirCI dashboard itself',
    })
  })

  it('judges by Sec-Fetch-Site when there is no Origin', async () => {
    expect((await post({ 'sec-fetch-site': 'cross-site' })).statusCode).toBe(403)
    expect((await post({ 'sec-fetch-site': 'same-site' })).statusCode).toBe(403)
    expect((await post({ 'sec-fetch-site': 'same-origin' })).statusCode).toBe(200)
    expect((await post({ 'sec-fetch-site': 'none' })).statusCode).toBe(200)
  })

  it('lets through requests with no browser headers at all (curl, scripts)', async () => {
    expect((await post({})).statusCode).toBe(200)
  })

  it('trusts Origin over Sec-Fetch-Site when both are present', async () => {
    expect(
      (await post({ origin: 'https://evil.example', 'sec-fetch-site': 'same-origin' })).statusCode,
    ).toBe(403)
  })
})
