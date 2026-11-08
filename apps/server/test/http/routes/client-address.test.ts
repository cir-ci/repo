import { tmpdir } from 'node:os'

import { FsStorage } from '@circi/storage'
import { createTestDb, type TestDb } from '@circi/testing'
import type { FastifyInstance } from 'fastify'
import { pino } from 'pino'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { buildServer } from '../../../src/http/app.ts'
import { createTestAuth, ORIGIN } from '../../support/helpers.ts'

let t: TestDb
let untrusting: FastifyInstance
let trusting: FastifyInstance

const PROXY = '192.0.2.10'

function serverWith(trustedProxies?: string[]): FastifyInstance {
  // Rate limiting is off outside production by default; these tests are about it.
  const auth = createTestAuth(t.db, undefined, { rateLimit: true })
  return buildServer({
    logger: pino({ level: 'silent' }),
    checks: [],
    ...(trustedProxies ? { trustedProxies } : {}),
    dashboard: { db: t.db, auth, storage: new FsStorage({ path: tmpdir() }), publicOrigin: ORIGIN },
  })
}

beforeAll(async () => {
  t = await createTestDb()
  untrusting = serverWith()
  trusting = serverWith([PROXY])
  await Promise.all([untrusting.ready(), trusting.ready()])
})
afterAll(async () => {
  await Promise.all([untrusting.close(), trusting.close()])
  await t.close()
})

/** A failed sign-in: the sign-in endpoint allows 3 of these per client address in a window. */
const signIn = (app: FastifyInstance, remoteAddress: string, forwardedFor: string) =>
  app.inject({
    method: 'POST',
    url: '/api/auth/sign-in/email',
    remoteAddress,
    headers: {
      origin: ORIGIN,
      'content-type': 'application/json',
      'x-forwarded-for': forwardedFor,
    },
    payload: { email: 'nobody@acme.test', password: 'wrong-password-long' },
  })

async function statuses(
  app: FastifyInstance,
  remoteAddress: string,
  forwardedFor: (i: number) => string,
) {
  const out: number[] = []
  for (let i = 0; i < 4; i += 1) {
    // eslint-disable-next-line no-await-in-loop -- order matters
    out.push((await signIn(app, remoteAddress, forwardedFor(i))).statusCode)
  }
  return out
}

describe('the client address behind the sign-in rate limit', () => {
  it('ignores X-Forwarded-For by default: spoofed headers do not escape the limiter', async () => {
    const result = await statuses(untrusting, '198.51.100.7', (i) => `203.0.113.${i + 1}`)
    expect(result.slice(0, 3)).not.toContain(429)
    expect(result[3]).toBe(429)
  })

  it('ignores a spoofed header even when it is a chain', async () => {
    const result = await statuses(untrusting, '198.51.100.8', (i) => `203.0.113.${i + 1}, 10.0.0.1`)
    expect(result[3]).toBe(429)
  })

  it('ignores X-Forwarded-For from an address that is not a trusted proxy', async () => {
    const result = await statuses(trusting, '198.51.100.9', (i) => `203.0.113.${i + 1}`)
    expect(result[3]).toBe(429)
  })

  it('counts clients behind a trusted proxy separately', async () => {
    const different = await statuses(trusting, PROXY, (i) => `203.0.113.${i + 20}`)
    expect(different).not.toContain(429)
    // And the same client through the proxy is still limited.
    const same = await statuses(trusting, PROXY, () => '203.0.113.99')
    expect(same[3]).toBe(429)
  })
})
