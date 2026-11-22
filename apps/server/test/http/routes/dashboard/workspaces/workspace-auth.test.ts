import { getWorkspaceAuthSettings, getSessionMethod } from '@circi/db/queries'
import { setWorkspaceAuthSettings } from '@circi/db/repositories'
import { createTestDb } from '@circi/db/testing'
import { FsStorage } from '@circi/storage'
import { fakeMailer, useTempDir } from '@circi/testing'
import type { FastifyInstance } from 'fastify'
import { pino } from 'pino'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { buildServer } from '#http/app.ts'
import { caller } from '#test/support/client.ts'
import { snapshotDb } from '#test/support/db-snapshot.ts'
import {
  createTestAuth,
  ORIGIN,
  seedTenant,
  signIn,
  signInWithEmailCode,
  type Tenant,
} from '#test/support/helpers.ts'

let t: createTestDb.Result
const tempDir = useTempDir('circi-orgauth')
let withEmail: FastifyInstance
let passwordOnly: FastifyInstance
const mailer = fakeMailer()

beforeAll(async () => {
  t = await createTestDb()
  const auth = createTestAuth(t.db, mailer)
  const deps = {
    db: t.db,
    auth,
    storage: new FsStorage({ path: tempDir.path }),
    publicOrigin: ORIGIN,
  }
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
})

let tenantAuth: ReturnType<typeof createTestAuth>

describe('per-workspace login methods', () => {
  let acme: Tenant
  let passwordCookie: string
  let emailCookie: string
  let reset: () => Promise<void>

  beforeAll(async () => {
    acme = await seedTenant(tenantAuth, t.db)
    passwordCookie = await signIn(withEmail, acme.owner.email, acme.owner.password)
    const signedIn = await signInWithEmailCode(withEmail, mailer, acme.owner.email)
    if (signedIn.status !== 200) throw new Error('the email code did not sign in')
    emailCookie = signedIn.cookie
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

    // The password session can no longer see it: projects, builds, settings, members, auth.
    const projects = (await caller(withEmail)('GET', '/api/projects', passwordCookie)).json()
      .projects
    expect(projects).toEqual([])
    const hidden = await Promise.all(
      [
        `/api/projects/${acme.workspaceSlug}/web`,
        `/api/projects/${acme.workspaceSlug}/web/settings`,
        `/api/workspaces/${acme.workspaceSlug}/auth`,
        `/api/auth/organization/get-full-organization?organizationSlug=${acme.workspaceSlug}`,
      ].map(async (url) => (await caller(withEmail)('GET', url, passwordCookie)).statusCode),
    )
    expect(hidden).toEqual([404, 404, 404, 404])
    const caps = (await caller(withEmail)('GET', '/api/capabilities', passwordCookie)).json()
    expect(caps.refusingWorkspaces).toEqual([{ name: expect.any(String), accepts: ['email'] }])
    expect(caps.manageableWorkspaces).toEqual([])

    // The email session still sees everything.
    expect(
      (await caller(withEmail)('GET', '/api/projects', emailCookie)).json().projects,
    ).toHaveLength(1)
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

  it('refuses to turn off the method this session signed in with, naming the field', async () => {
    const off = await caller(withEmail)(
      'PATCH',
      `/api/workspaces/${acme.workspaceSlug}/auth`,
      passwordCookie,
      { passwordLoginEnabled: false },
    )
    expect(off.statusCode).toBe(400)
    expect(off.json().error).toBe(
      'You signed in with a password. Sign in with another method this workspace accepts before turning passwords off.',
    )
    expect(off.json().fields).toEqual({ passwordLoginEnabled: off.json().error })
    // Nothing changed, and the session still opens the workspace.
    const after = await caller(withEmail)(
      'GET',
      `/api/workspaces/${acme.workspaceSlug}/auth`,
      passwordCookie,
    )
    expect(after.statusCode).toBe(200)
    expect(after.json().settings.passwordLoginEnabled).toBe(true)
    // The same goes for an email-code session and email codes.
    const own = await caller(withEmail)(
      'PATCH',
      `/api/workspaces/${acme.workspaceSlug}/auth`,
      emailCookie,
      { emailLoginEnabled: false },
    )
    expect(own.statusCode).toBe(400)
    expect(own.json().fields).toHaveProperty('emailLoginEnabled')
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

  it('rejects unknown fields', async () => {
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
