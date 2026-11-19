import { pino } from 'pino'
import { describe, expect, it } from 'vitest'

import { buildServer } from '#http/app.ts'

import pkg from '../../../package.json' with { type: 'json' }

const logger = pino({ level: 'silent' })

describe('health endpoints', () => {
  it('/healthz answers without touching dependencies, with the version this server runs', async () => {
    const app = buildServer({
      logger,
      checks: [{ name: 'database', check: () => Promise.reject(new Error('down')) }],
    })
    const res = await app.inject({ method: 'GET', url: '/healthz' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ status: 'ok', version: pkg.version })
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
})
