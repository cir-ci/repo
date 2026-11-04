import { pino } from 'pino'
import { describe, expect, it } from 'vitest'

import { buildServer } from '../../src/http/app.ts'

const logger = pino({ level: 'silent' })

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
