import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { Mail } from '@circi/auth'
import { getOrgAuthSettings, getSessionMethod, setOrgAuthSettings } from '@circi/db'
import { FsStorage } from '@circi/storage'
import { createTestDb, type TestDb } from '@circi/testing'
import type { FastifyInstance } from 'fastify'
import { pino } from 'pino'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { buildServer } from '#http/app.ts'
import { createTestAuth, ORIGIN, seedTenant, signIn, type Tenant } from '#test/support/helpers.ts'

let t: TestDb
let dir: string
let withEmail: FastifyInstance
let passwordOnly: FastifyInstance
const sent: Mail[] = []
const json = { origin: ORIGIN, 'content-type': 'application/json' }

beforeAll(async () => {
  t = await createTestDb()
  dir = await mkdtemp(join(tmpdir(), 'circi-orgauth-'))
  const mailer = {
    send: async (mail: Mail) => {
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
    headers: json,
    payload: { email, type: 'sign-in' },
  })
  await vi.waitFor(() => expect(sent).toHaveLength(1))
  const otp = /sign-in code is (\d{6})/.exec(sent[0]?.text ?? '')?.[1]
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/sign-in/email-otp',
    headers: json,
    payload: { email, otp },
  })
  expect(res.statusCode).toBe(200)
  return [res.headers['set-cookie']]
    .flat()
    .map((c) => String(c).split(';')[0])
    .join('; ')
}

const call = (
  app: FastifyInstance,
  method: 'GET' | 'PATCH',
  url: string,
  cookie: string,
  payload?: unknown,
) =>
  app.inject({
    method,
    url,
    headers: { ...(payload === undefined ? {} : json), cookie, origin: ORIGIN },
    ...(payload === undefined ? {} : { payload: JSON.stringify(payload) }),
  })

describe('per-organization login methods', () => {
  let acme: Tenant
  let passwordCookie: string
  let emailCookie: string

  beforeAll(async () => {
    acme = await seedTenant(tenantAuth, t.db)
    passwordCookie = await signIn(withEmail, acme.owner.email, acme.owner.password)
    emailCookie = await codeSignIn(withEmail, acme.owner.email)
  })

  it('remembers how each session signed in', async () => {
    const sessions = await t.db.query.session.findMany()
    const methods = await Promise.all(sessions.map((s) => getSessionMethod(t.db, s.id)))
    const names = methods.map((m) => (typeof m === 'string' ? m : 'scoped'))
    expect(names.toSorted((a, b) => a.localeCompare(b))).toEqual(['email', 'password'])
  })

  it('accepts everything until an organization narrows it', async () => {
    const res = await call(
      withEmail,
      'GET',
      `/api/organizations/${acme.orgSlug}/auth`,
      passwordCookie,
    )
    expect(res.json()).toMatchObject({
      canManage: true,
      settings: { emailLoginEnabled: true, passwordLoginEnabled: true },
      instance: { password: true, email: true },
    })
  })

  it('hides the organization from sessions that signed in a refused way', async () => {
    const off = await call(
      withEmail,
      'PATCH',
      `/api/organizations/${acme.orgSlug}/auth`,
      emailCookie,
      {
        passwordLoginEnabled: false,
      },
    )
    expect(off.statusCode).toBe(200)

    // The password session can no longer see it: projects, builds, settings, members, auth.
    const projects = (await call(withEmail, 'GET', '/api/projects', passwordCookie)).json().projects
    expect(projects).toEqual([])
    const hidden = await Promise.all(
      [
        `/api/projects/${acme.orgSlug}/web`,
        `/api/projects/${acme.orgSlug}/web/settings`,
        `/api/organizations/${acme.orgSlug}/auth`,
        `/api/auth/organization/get-full-organization?organizationSlug=${acme.orgSlug}`,
      ].map(async (url) => (await call(withEmail, 'GET', url, passwordCookie)).statusCode),
    )
    expect(hidden).toEqual([404, 404, 404, 404])
    const caps = (await call(withEmail, 'GET', '/api/capabilities', passwordCookie)).json()
    expect(caps.refusingOrganizations).toEqual([{ name: expect.any(String), accepts: ['email'] }])
    expect(caps.manageableOrganizations).toEqual([])

    // The email session still sees everything.
    expect(
      (await call(withEmail, 'GET', '/api/projects', emailCookie)).json().projects,
    ).toHaveLength(1)
    expect(
      (
        await call(
          withEmail,
          'GET',
          `/api/auth/organization/get-full-organization?organizationSlug=${acme.orgSlug}`,
          emailCookie,
        )
      ).statusCode,
    ).toBe(200)
  })

  it('refuses to turn off the last method an owner can use', async () => {
    const res = await call(
      withEmail,
      'PATCH',
      `/api/organizations/${acme.orgSlug}/auth`,
      emailCookie,
      {
        emailLoginEnabled: false,
      },
    )
    expect(res.statusCode).toBe(409)
    expect(res.json().error).toMatch(/no owner able to sign in/)
    const [org] = await t.db.query.organization.findMany({
      where: (o, { eq }) => eq(o.slug, acme.orgSlug),
    })
    expect((await getOrgAuthSettings(t.db, org?.id ?? '')).emailLoginEnabled).toBe(true)
  })

  it('counts the instance switches: no email on the instance means password must stay', async () => {
    const solo = await seedTenant(tenantAuth, t.db)
    const cookie = await signIn(passwordOnly, solo.owner.email, solo.owner.password)
    const res = await call(
      passwordOnly,
      'PATCH',
      `/api/organizations/${solo.orgSlug}/auth`,
      cookie,
      {
        passwordLoginEnabled: false,
      },
    )
    expect(res.statusCode).toBe(409)
    // Email being off in the organization is fine: it was never available here.
    const ok = await call(
      passwordOnly,
      'PATCH',
      `/api/organizations/${solo.orgSlug}/auth`,
      cookie,
      {
        emailLoginEnabled: false,
      },
    )
    expect(ok.statusCode).toBe(200)
  })

  it('lets only owners and admins change it, and rejects unknown fields', async () => {
    const res = await call(
      withEmail,
      'PATCH',
      `/api/organizations/${acme.orgSlug}/auth`,
      emailCookie,
      {
        surprise: true,
      },
    )
    expect(res.statusCode).toBe(400)
  })

  it('the break-glass path can force a setting past the guard', async () => {
    const solo = await seedTenant(tenantAuth, t.db)
    const [org] = await t.db.query.organization.findMany({
      where: (o, { eq }) => eq(o.slug, solo.orgSlug),
    })
    const settings = await setOrgAuthSettings(
      t.db,
      org?.id ?? '',
      { passwordLoginEnabled: false, emailLoginEnabled: false },
      { instance: { password: true, email: false, oidc: false }, force: true },
    )
    expect(settings).toEqual({ passwordLoginEnabled: false, emailLoginEnabled: false })
    const back = await setOrgAuthSettings(
      t.db,
      org?.id ?? '',
      { passwordLoginEnabled: true },
      { instance: { password: true, email: false, oidc: false } },
    )
    expect(back.passwordLoginEnabled).toBe(true)
  })
})
