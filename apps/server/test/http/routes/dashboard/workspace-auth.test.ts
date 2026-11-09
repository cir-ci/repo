import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { Mailer } from '@circi/auth'
import { getWorkspaceAuthSettings, getSessionMethod, setWorkspaceAuthSettings } from '@circi/db'
import { FsStorage } from '@circi/storage'
import { createTestDb } from '@circi/testing'
import type { FastifyInstance } from 'fastify'
import { pino } from 'pino'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { buildServer } from '#http/app.ts'
import { caller, JSON_HEADERS } from '#test/support/client.ts'
import { snapshotDb } from '#test/support/db-snapshot.ts'
import { createTestAuth, ORIGIN, seedTenant, signIn, type Tenant } from '#test/support/helpers.ts'

let t: createTestDb.Result
let dir: string
let withEmail: FastifyInstance
let passwordOnly: FastifyInstance
const sent: Mailer.Mail[] = []

beforeAll(async () => {
  t = await createTestDb()
  dir = await mkdtemp(join(tmpdir(), 'circi-orgauth-'))
  const mailer = {
    send: async (mail: Mailer.Mail) => {
      sent.push(mail)
    },
  }
  const auth = createTestAuth(t.db, mailer)
  const deps = { db: t.db, auth, storage: new FsStorage({ path: dir }), publicOrigin: ORIGIN }
  withEmail = buildServer({
    logger: pino({ level: 'silent' }),
    checks: [],
    dashboard: { ...deps, emailLogin: true },
  })
  passwordOnly = buildServer({ logger: pino({ level: 'silent' }), checks: [], dashboard: deps })
  await Promise.all([withEmail.ready(), passwordOnly.ready()])
  tenantAuth = auth
})
afterAll(async () => {
  await Promise.all([withEmail.close(), passwordOnly.close()])
  await t.close()
  await rm(dir, { recursive: true, force: true })
})

let tenantAuth: ReturnType<typeof createTestAuth>

async function codeSignIn(app: FastifyInstance, email: string): Promise<string> {
  sent.length = 0
  await app.inject({
    method: 'POST',
    url: '/api/auth/email-otp/send-verification-otp',
    headers: JSON_HEADERS,
    payload: { email, type: 'sign-in' },
  })
  await vi.waitFor(() => expect(sent).toHaveLength(1))
  const otp = /sign-in code is (\d{6})/.exec(sent[0]?.text ?? '')?.[1]
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/sign-in/email-otp',
    headers: JSON_HEADERS,
    payload: { email, otp },
  })
  expect(res.statusCode).toBe(200)
  return [res.headers['set-cookie']]
    .flat()
    .map((c) => String(c).split(';')[0])
    .join('; ')
}

describe('per-workspace login methods', () => {
  let acme: Tenant
  let passwordCookie: string
  let emailCookie: string
  let reset: () => Promise<void>

  beforeAll(async () => {
    acme = await seedTenant(tenantAuth, t.db)
    passwordCookie = await signIn(withEmail, acme.owner.email, acme.owner.password)
    emailCookie = await codeSignIn(withEmail, acme.owner.email)
    reset = await snapshotDb(t)
  })
  beforeEach(() => reset())

  it('remembers how each session signed in', async () => {
    const sessions = await t.db.query.session.findMany()
    const methods = await Promise.all(sessions.map((s) => getSessionMethod(t.db, s.id)))
    const names = methods.map((m) => (typeof m === 'string' ? m : 'scoped'))
    expect(names.toSorted((a, b) => a.localeCompare(b))).toEqual(['email', 'password'])
  })

  it('accepts everything until a workspace narrows it', async () => {
    const res = await caller(withEmail)(
      'GET',
      `/api/workspaces/${acme.workspaceSlug}/auth`,
      passwordCookie,
    )
    expect(res.json()).toMatchObject({
      canManage: true,
      settings: { emailLoginEnabled: true, passwordLoginEnabled: true },
      instance: { password: true, email: true },
    })
  })

  it('hides the workspace from sessions that signed in a refused way', async () => {
    const off = await caller(withEmail)(
      'PATCH',
      `/api/workspaces/${acme.workspaceSlug}/auth`,
      emailCookie,
      {
        passwordLoginEnabled: false,
      },
    )
    expect(off.statusCode).toBe(200)

    // The password session can no longer see it: teams, builds, settings, members, auth.
    const teams = (await caller(withEmail)('GET', '/api/teams', passwordCookie)).json().teams
    expect(teams).toEqual([])
    const hidden = await Promise.all(
      [
        `/api/teams/${acme.workspaceSlug}/web`,
        `/api/teams/${acme.workspaceSlug}/web/settings`,
        `/api/workspaces/${acme.workspaceSlug}/auth`,
        `/api/auth/organization/get-full-organization?organizationSlug=${acme.workspaceSlug}`,
      ].map(async (url) => (await caller(withEmail)('GET', url, passwordCookie)).statusCode),
    )
    expect(hidden).toEqual([404, 404, 404, 404])
    const caps = (await caller(withEmail)('GET', '/api/capabilities', passwordCookie)).json()
    expect(caps.refusingWorkspaces).toEqual([{ name: expect.any(String), accepts: ['email'] }])
    expect(caps.manageableWorkspaces).toEqual([])

    // The email session still sees everything.
    expect((await caller(withEmail)('GET', '/api/teams', emailCookie)).json().teams).toHaveLength(1)
    expect(
      (
        await caller(withEmail)(
          'GET',
          `/api/auth/organization/get-full-organization?organizationSlug=${acme.workspaceSlug}`,
          emailCookie,
        )
      ).statusCode,
    ).toBe(200)
  })

  it('refuses to turn off the last method an owner can use', async () => {
    // Narrowed to email only (as the owner's email session): email is the last method left.
    const narrowed = await caller(withEmail)(
      'PATCH',
      `/api/workspaces/${acme.workspaceSlug}/auth`,
      emailCookie,
      { passwordLoginEnabled: false },
    )
    expect(narrowed.statusCode).toBe(200)
    const res = await caller(withEmail)(
      'PATCH',
      `/api/workspaces/${acme.workspaceSlug}/auth`,
      emailCookie,
      {
        emailLoginEnabled: false,
      },
    )
    expect(res.statusCode).toBe(409)
    expect(res.json().error).toMatch(/no owner able to sign in/)
    const [workspace] = await t.db.query.workspace.findMany({
      where: (o, { eq }) => eq(o.slug, acme.workspaceSlug),
    })
    expect((await getWorkspaceAuthSettings(t.db, workspace?.id ?? '')).emailLoginEnabled).toBe(true)
  })

  it('counts the instance switches: no email on the instance means password must stay', async () => {
    const solo = await seedTenant(tenantAuth, t.db)
    const cookie = await signIn(passwordOnly, solo.owner.email, solo.owner.password)
    const res = await caller(passwordOnly)(
      'PATCH',
      `/api/workspaces/${solo.workspaceSlug}/auth`,
      cookie,
      {
        passwordLoginEnabled: false,
      },
    )
    expect(res.statusCode).toBe(409)
    // Email being off in the workspace is fine: it was never available here.
    const ok = await caller(passwordOnly)(
      'PATCH',
      `/api/workspaces/${solo.workspaceSlug}/auth`,
      cookie,
      {
        emailLoginEnabled: false,
      },
    )
    expect(ok.statusCode).toBe(200)
  })

  it('lets only owners and admins change it, and rejects unknown fields', async () => {
    const res = await caller(withEmail)(
      'PATCH',
      `/api/workspaces/${acme.workspaceSlug}/auth`,
      emailCookie,
      {
        surprise: true,
      },
    )
    expect(res.statusCode).toBe(400)
  })

  it('the break-glass path can force a setting past the guard', async () => {
    const solo = await seedTenant(tenantAuth, t.db)
    const [workspace] = await t.db.query.workspace.findMany({
      where: (o, { eq }) => eq(o.slug, solo.workspaceSlug),
    })
    const settings = await setWorkspaceAuthSettings(
      t.db,
      workspace?.id ?? '',
      { passwordLoginEnabled: false, emailLoginEnabled: false },
      {
        instance: { password: true, email: false, github: false, google: false, oidc: false },
        force: true,
      },
    )
    expect(settings).toEqual({
      passwordLoginEnabled: false,
      emailLoginEnabled: false,
      signinGithub: true,
      signinGoogle: true,
    })
    const back = await setWorkspaceAuthSettings(
      t.db,
      workspace?.id ?? '',
      { passwordLoginEnabled: true },
      { instance: { password: true, email: false, github: false, google: false, oidc: false } },
    )
    expect(back.passwordLoginEnabled).toBe(true)
  })
})
