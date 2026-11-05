import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createUser, setupCode, verifyProjectToken } from '@circi/auth'
import type { Auth } from '@circi/auth'
import { countUsers, recordPublicUrl } from '@circi/db'
import { FsStorage } from '@circi/storage'
import { createTestDb, type TestDb } from '@circi/testing'
import type { FastifyInstance } from 'fastify'
import { pino } from 'pino'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { buildServer } from '../../src/http/app.ts'
import { createTestAuth, ORIGIN, signIn } from '../helpers.ts'

const SECRET = 'test-secret-that-is-long-enough-1234'
const PASSWORD = 'first-admin-password-1'

let t: TestDb
let dir: string
let auth: Auth
let dir2: string

async function serverWith(orgCreation?: 'admin' | 'anyone'): Promise<FastifyInstance> {
  const app = buildServer({
    logger: pino({ level: 'silent' }),
    checks: [],
    dashboard: {
      db: t.db,
      auth,
      storage: new FsStorage({ path: join(dir, 'files') }),
      publicOrigin: ORIGIN,
      authSecret: SECRET,
      ...(orgCreation ? { orgCreation } : {}),
    },
  })
  await app.ready()
  return app
}

beforeAll(async () => {
  t = await createTestDb()
  auth = createTestAuth(t.db)
  dir = await mkdtemp(join(tmpdir(), 'circi-onboarding-'))
  dir2 = dir
})
afterAll(async () => {
  await t.close()
  await rm(dir2, { recursive: true, force: true })
})

const post = (app: FastifyInstance, url: string, body: unknown, cookie = '') =>
  app.inject({
    method: 'POST',
    url,
    headers: { origin: ORIGIN, 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    payload: JSON.stringify(body),
  })

describe('first-run setup', () => {
  it('claims a fresh install with the setup code, once', async () => {
    const app = await serverWith()
    expect((await app.inject({ method: 'GET', url: '/api/setup' })).json()).toEqual({
      needed: true,
    })
    expect(await countUsers(t.db)).toBe(0)

    const input = {
      name: 'First Admin',
      email: 'Admin@Acme.test',
      password: PASSWORD,
      organizationName: 'Acme Inc',
    }
    const wrong = await post(app, '/api/setup', { ...input, code: 'nope' })
    expect(wrong.statusCode).toBe(403)
    expect(await countUsers(t.db)).toBe(0)

    const short = await post(app, '/api/setup', {
      ...input,
      code: setupCode(SECRET),
      password: 'short',
    })
    expect(short.statusCode).toBe(400)
    expect(await countUsers(t.db)).toBe(0)

    const ok = await post(app, '/api/setup', { ...input, code: setupCode(SECRET) })
    expect(ok.statusCode).toBe(201)
    expect(ok.json()).toEqual({ email: 'admin@acme.test', organization: { slug: 'acme-inc' } })

    // The new account signs in and owns the organization.
    const cookie = await signIn(app, 'admin@acme.test', PASSWORD)
    const caps = await app.inject({ method: 'GET', url: '/api/capabilities', headers: { cookie } })
    expect(caps.json()).toEqual({
      canCreateOrganization: true,
      refusingOrganizations: [],
      manageableOrganizations: [{ slug: 'acme-inc', name: 'Acme Inc' }],
    })

    // Setup is gone for good.
    expect((await app.inject({ method: 'GET', url: '/api/setup' })).json()).toEqual({
      needed: false,
    })
    const again = await post(app, '/api/setup', {
      ...input,
      email: 'x@acme.test',
      code: setupCode(SECRET),
    })
    expect(again.statusCode).toBe(404)
    await app.close()
  })

  it('refuses a request from another site', async () => {
    const app = await serverWith()
    const res = await app.inject({
      method: 'POST',
      url: '/api/setup',
      headers: { origin: 'https://evil.example', 'content-type': 'application/json' },
      payload: '{}',
    })
    expect(res.statusCode).toBe(403)
    await app.close()
  })
})

describe('creating organizations and projects', () => {
  it('limits organization creation to instance admins by default', async () => {
    const app = await serverWith()
    const admin = await signIn(app, 'admin@acme.test', PASSWORD)
    await createUser(auth, { email: 'plain@acme.test', name: 'Plain', password: PASSWORD })
    const plain = await signIn(app, 'plain@acme.test', PASSWORD)

    const denied = await post(app, '/api/organizations', { name: 'Mine' }, plain)
    expect(denied.statusCode).toBe(403)
    const allowed = await post(app, '/api/organizations', { name: 'Second Org' }, admin)
    expect(allowed.statusCode).toBe(201)
    expect(allowed.json().organization).toEqual({ slug: 'second-org', name: 'Second Org' })
    const caps = await app.inject({
      method: 'GET',
      url: '/api/capabilities',
      headers: { cookie: plain },
    })
    expect(caps.json()).toEqual({
      canCreateOrganization: false,
      manageableOrganizations: [],
      refusingOrganizations: [],
    })
    await app.close()
  })

  it('lets anyone create one with ORG_CREATION=anyone, and they own it', async () => {
    const app = await serverWith('anyone')
    const plain = await signIn(app, 'plain@acme.test', PASSWORD)
    const res = await post(app, '/api/organizations', { name: 'Plain Org' }, plain)
    expect(res.statusCode).toBe(201)
    const project = await post(
      app,
      '/api/organizations/plain-org/projects',
      { name: 'Web App' },
      plain,
    )
    expect(project.statusCode).toBe(201)
    expect(project.json().project).toEqual({ slug: 'web-app', name: 'Web App' })
    expect(project.json().token).toMatch(/^circi_/)
    await app.close()
  })

  it('creates projects only for owners and admins, hiding other organizations', async () => {
    const app = await serverWith()
    const admin = await signIn(app, 'admin@acme.test', PASSWORD)
    const plain = await signIn(app, 'plain@acme.test', PASSWORD)
    // `plain` is not in acme-inc at all: same answer as for a missing organization.
    expect(
      (await post(app, '/api/organizations/acme-inc/projects', { name: 'X' }, plain)).statusCode,
    ).toBe(404)
    expect(
      (await post(app, '/api/organizations/nope/projects', { name: 'X' }, plain)).statusCode,
    ).toBe(404)
    expect(
      (await post(app, '/api/organizations/acme-inc/projects', { name: 'Site' }, admin)).statusCode,
    ).toBe(201)
    // Same name twice: a conflict, not a crash.
    expect(
      (await post(app, '/api/organizations/acme-inc/projects', { name: 'Site' }, admin)).statusCode,
    ).toBe(409)
    await app.close()
  })

  it('rotates a project token, and the old one stops working', async () => {
    const app = await serverWith('anyone')
    const plain = await signIn(app, 'plain@acme.test', PASSWORD)
    const created = (
      await post(app, '/api/organizations/plain-org/projects', { name: 'Rotating' }, plain)
    ).json()
    const rotated = await post(app, '/api/projects/plain-org/rotating/token', {}, plain)
    expect(rotated.statusCode).toBe(200)
    expect(rotated.json().token).toMatch(/^circi_/)
    expect(rotated.json().token).not.toBe(created.token)
    expect(await verifyProjectToken(auth, t.db, created.token)).toBeUndefined()
    expect(await verifyProjectToken(auth, t.db, rotated.json().token)).toBeDefined()
    const admin = await signIn(app, 'admin@acme.test', PASSWORD)
    expect((await post(app, '/api/projects/plain-org/rotating/token', {}, admin)).statusCode).toBe(
      404,
    )
    await app.close()
  })
})

describe('instance notices', () => {
  it('tells instance admins about a moved dashboard, until dismissed', async () => {
    const app = await serverWith()
    await recordPublicUrl(t.db, 'https://ci.old.io')
    await recordPublicUrl(t.db, ORIGIN)
    const admin = await signIn(app, 'admin@acme.test', PASSWORD)
    const plain = await signIn(app, 'plain@acme.test', PASSWORD)
    const get = (cookie: string) =>
      app.inject({ method: 'GET', url: '/api/instance/notices', headers: { cookie } })

    const notice = (await get(admin)).json().publicUrlChange
    expect(notice).toMatchObject({ from: 'https://ci.old.io', to: ORIGIN })
    expect(notice.checklist.length).toBeGreaterThan(0)
    expect((await get(plain)).json()).toEqual({ publicUrlChange: null })

    expect(
      (await post(app, '/api/instance/notices/public-url/dismiss', {}, plain)).statusCode,
    ).toBe(403)
    expect(
      (await post(app, '/api/instance/notices/public-url/dismiss', {}, admin)).statusCode,
    ).toBe(204)
    expect((await get(admin)).json()).toEqual({ publicUrlChange: null })
    await app.close()
  })
})
