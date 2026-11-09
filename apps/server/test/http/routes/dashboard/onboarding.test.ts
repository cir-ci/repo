import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createUser, setupCode, verifyTeamToken } from '@circi/auth'
import type { Auth } from '@circi/auth'
import { teamColorFor } from '@circi/core'
import { countUsers, recordPublicUrl } from '@circi/db'
import { FsStorage } from '@circi/storage'
import { createTestDb } from '@circi/testing'
import type { FastifyInstance } from 'fastify'
import { pino } from 'pino'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { buildServer } from '#http/app.ts'
import { clientFor } from '#test/support/client.ts'
import { createTestAuth, ORIGIN, signIn } from '#test/support/helpers.ts'

const SECRET = 'test-secret-that-is-long-enough-1234'
const PASSWORD = 'first-admin-password-1'

let t: createTestDb.Result
let dir: string
let auth: Auth
let dir2: string

async function serverWith(workspaceCreation?: 'admin' | 'anyone'): Promise<FastifyInstance> {
  const app = buildServer({
    logger: pino({ level: 'silent' }),
    checks: [],
    dashboard: {
      db: t.db,
      auth,
      storage: new FsStorage({ path: join(dir, 'files') }),
      publicOrigin: ORIGIN,
      authSecret: SECRET,
      ...(workspaceCreation ? { workspaceCreation } : {}),
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
beforeEach(async () => {
  await t.reset()
})
afterAll(async () => {
  await t.close()
  await rm(dir2, { recursive: true, force: true })
})

const post = (app: FastifyInstance, url: string, body: unknown, cookie = '') =>
  clientFor(app, cookie).send('POST', url, body)

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
      workspaceName: 'Acme Inc',
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
    expect(ok.json()).toEqual({ email: 'admin@acme.test', workspace: { slug: 'acme-inc' } })

    // The new account signs in and owns the workspace.
    const cookie = await signIn(app, 'admin@acme.test', PASSWORD)
    const caps = await app.inject({ method: 'GET', url: '/api/capabilities', headers: { cookie } })
    expect(caps.json()).toEqual({
      canCreateWorkspace: true,
      instanceAdmin: true,
      refusingWorkspaces: [],
      mailConfigured: false,
      manageableWorkspaces: [{ slug: 'acme-inc', name: 'Acme Inc' }],
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

/** A claimed instance (the setup route ran: `admin@acme.test` is its admin) plus a plain account. */
async function claimedInstance(workspaceCreation?: 'admin' | 'anyone') {
  const app = await serverWith(workspaceCreation)
  const claimed = await post(app, '/api/setup', {
    name: 'First Admin',
    email: 'admin@acme.test',
    password: PASSWORD,
    workspaceName: 'Acme Inc',
    code: setupCode(SECRET),
  })
  expect(claimed.statusCode).toBe(201)
  await createUser(auth, { email: 'plain@acme.test', name: 'Plain', password: PASSWORD })
  return {
    app,
    admin: await signIn(app, 'admin@acme.test', PASSWORD),
    plain: await signIn(app, 'plain@acme.test', PASSWORD),
  }
}

describe('creating workspaces and teams', () => {
  it('limits workspace creation to instance admins by default', async () => {
    const { app, admin, plain } = await claimedInstance()

    const denied = await post(app, '/api/workspaces', { name: 'Mine' }, plain)
    expect(denied.statusCode).toBe(403)
    const allowed = await post(app, '/api/workspaces', { name: 'Second Workspace' }, admin)
    expect(allowed.statusCode).toBe(201)
    expect(allowed.json().workspace).toEqual({ slug: 'second-workspace', name: 'Second Workspace' })
    const caps = await app.inject({
      method: 'GET',
      url: '/api/capabilities',
      headers: { cookie: plain },
    })
    expect(caps.json()).toEqual({
      canCreateWorkspace: false,
      instanceAdmin: false,
      manageableWorkspaces: [],
      refusingWorkspaces: [],
      mailConfigured: false,
    })
    await app.close()
  })

  it('lets anyone create one with WORKSPACE_CREATION=anyone, and they own it', async () => {
    const { app, plain } = await claimedInstance('anyone')
    const res = await post(app, '/api/workspaces', { name: 'Plain Workspace' }, plain)
    expect(res.statusCode).toBe(201)
    const team = await post(
      app,
      '/api/workspaces/plain-workspace/teams',
      { name: 'Web App' },
      plain,
    )
    expect(team.statusCode).toBe(201)
    expect(team.json().team).toEqual({
      slug: 'web-app',
      name: 'Web App',
      color: teamColorFor('Web App'),
      icon: null,
    })
    expect(team.json().token).toMatch(/^circi_/)
    await app.close()
  })

  it('creates teams only for owners and admins, hiding other workspaces', async () => {
    const { app, admin, plain } = await claimedInstance()
    // `plain` is not in acme-inc at all: same answer as for a missing workspace.
    expect(
      (await post(app, '/api/workspaces/acme-inc/teams', { name: 'X' }, plain)).statusCode,
    ).toBe(404)
    expect((await post(app, '/api/workspaces/nope/teams', { name: 'X' }, plain)).statusCode).toBe(
      404,
    )
    expect(
      (await post(app, '/api/workspaces/acme-inc/teams', { name: 'Site' }, admin)).statusCode,
    ).toBe(201)
    // Same name twice: a conflict, not a crash.
    expect(
      (await post(app, '/api/workspaces/acme-inc/teams', { name: 'Site' }, admin)).statusCode,
    ).toBe(409)
    await app.close()
  })

  it('rotates a team token, and the old one stops working', async () => {
    const { app, admin, plain } = await claimedInstance('anyone')
    expect(
      (await post(app, '/api/workspaces', { name: 'Plain Workspace' }, plain)).statusCode,
    ).toBe(201)
    const created = (
      await post(app, '/api/workspaces/plain-workspace/teams', { name: 'Rotating' }, plain)
    ).json()
    const rotated = await post(app, '/api/teams/plain-workspace/rotating/token', {}, plain)
    expect(rotated.statusCode).toBe(200)
    expect(rotated.json().token).toMatch(/^circi_/)
    expect(rotated.json().token).not.toBe(created.token)
    expect(await verifyTeamToken(auth, t.db, created.token)).toBeUndefined()
    expect(await verifyTeamToken(auth, t.db, rotated.json().token)).toBeDefined()
    expect(
      (await post(app, '/api/teams/plain-workspace/rotating/token', {}, admin)).statusCode,
    ).toBe(404)
    await app.close()
  })
})

describe('instance notices', () => {
  it('tells instance admins about a moved dashboard, until dismissed', async () => {
    const { app, admin, plain } = await claimedInstance()
    await recordPublicUrl(t.db, 'https://ci.old.io')
    await recordPublicUrl(t.db, ORIGIN)
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
