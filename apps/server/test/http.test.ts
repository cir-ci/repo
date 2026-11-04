import { pino } from 'pino'
import { describe, expect, it } from 'vitest'

import { buildServer } from '../src/http.ts'

const logger = pino({ level: 'silent' })

describe('health endpoints', () => {
  it('/healthz answers without touching dependencies', async () => {
    const app = buildServer({
      logger,
      checks: [{ name: 'database', check: () => Promise.reject(new Error('down')) }],
    })
    const res = await app.inject({ method: 'GET', url: '/healthz' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ status: 'ok' })
  })

  it('/readyz is 200 when every check passes', async () => {
    const app = buildServer({
      logger,
      checks: [
        { name: 'database', check: async () => {} },
        { name: 'storage', check: async () => {} },
      ],
    })
    const res = await app.inject({ method: 'GET', url: '/readyz' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ status: 'ok', checks: { database: 'ok', storage: 'ok' } })
  })

  it('/readyz is 503 and names the failing check', async () => {
    const app = buildServer({
      logger,
      checks: [
        { name: 'database', check: async () => {} },
        { name: 'storage', check: () => Promise.reject(new Error('disk full')) },
      ],
    })
    const res = await app.inject({ method: 'GET', url: '/readyz' })
    expect(res.statusCode).toBe(503)
    expect(res.json()).toEqual({ status: 'fail', checks: { database: 'ok', storage: 'fail' } })
  })

  it('/readyz times out a hung check instead of hanging', async () => {
    const app = buildServer({
      logger,
      checkTimeoutMs: 50,
      checks: [{ name: 'database', check: () => new Promise(() => {}) }],
    })
    const res = await app.inject({ method: 'GET', url: '/readyz' })
    expect(res.statusCode).toBe(503)
  })

  describe('previous dashboard addresses', () => {
    const app = buildServer({
      logger,
      checks: [],
      publicOrigin: 'https://ci.acme.io',
      previousHosts: ['circi.acme.io', 'old.acme.io:8443'],
    })

    it('redirects old hosts to the new address, keeping path and query', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/acme/web/builds/42?tab=changed',
        headers: { host: 'CIRCI.acme.io' },
      })
      expect(res.statusCode).toBe(308)
      expect(res.headers.location).toBe('https://ci.acme.io/acme/web/builds/42?tab=changed')
    })

    it('matches the port as part of the host', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/builds',
        headers: { host: 'old.acme.io:8443' },
      })
      expect(res.statusCode).toBe(308)
      expect(res.headers.location).toBe('https://ci.acme.io/v1/builds')
    })

    it('serves requests to the current host normally', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/healthz',
        headers: { host: 'ci.acme.io' },
      })
      expect(res.statusCode).toBe(200)
    })
  })
})
