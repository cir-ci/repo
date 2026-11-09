import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { Auth } from '@circi/auth'
import { createTestDb } from '@circi/db/testing'
import { FsStorage } from '@circi/storage'
import Fastify, { type FastifyInstance } from 'fastify'
import { pino } from 'pino'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { buildServer } from '#http/app.ts'
import { currentUser, requireSession } from '#http/hooks/session.ts'
import { createTestAuth, ORIGIN, seedTenant, signIn, type Tenant } from '#test/support/helpers.ts'

let t: createTestDb.Result
let auth: Auth
let app: FastifyInstance
let tenant: Tenant
let cookie: string

beforeAll(async () => {
  t = await createTestDb()
  auth = createTestAuth(t.db)
  // A bare app for the hook, plus the real server just to sign in through /api/auth.
  app = Fastify()
  app.addHook('onRequest', requireSession(auth, t.db))
  app.get('/me', (req) => currentUser(req))
  await app.ready()
  tenant = await seedTenant(auth, t.db)
  const server = buildServer({
    logger: pino({ level: 'silent' }),
    checks: [],
    dashboard: {
      db: t.db,
      auth,
      storage: new FsStorage({ path: join(tmpdir(), 'circi-session-hook') }),
      publicOrigin: ORIGIN,
    },
  })
  cookie = await signIn(server, tenant.owner.email, tenant.owner.password)
  await server.close()
})
afterAll(async () => {
  await app.close()
  await t.close()
})

describe('requireSession', () => {
  it('answers 401 without a session cookie', async () => {
    const res = await app.inject({ method: 'GET', url: '/me' })
    expect(res.statusCode).toBe(401)
    expect(res.json()).toEqual({ error: 'Sign in to continue' })
  })

  it('answers 401 for a cookie that is not a session', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/me',
      headers: { cookie: '__Host-circi.session_token=nonsense' },
    })
    expect(res.statusCode).toBe(401)
  })

  it('puts the signed-in user, with the login method, on the request', async () => {
    const res = await app.inject({ method: 'GET', url: '/me', headers: { cookie } })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({
      id: tenant.owner.id,
      email: tenant.owner.email,
      method: expect.any(String),
      sessionId: expect.any(String),
    })
  })
})
