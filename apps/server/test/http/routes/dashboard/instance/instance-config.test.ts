import { createServer, type Server } from 'node:http'

import type { InstanceAdmin } from '@circi/api'
import { callbackUrl, createAuth, createUser, type Mailer } from '@circi/auth'
import { loadConfig } from '@circi/config'
import { getWorkspaceSettings } from '@circi/db/queries'
import { createTestDb } from '@circi/db/testing'
import { createInstanceConfig, type InstanceConfigStore } from '@circi/services'
import { FsStorage } from '@circi/storage'
import { fakeMailer, TEST_AUTH_SECRET, useTempDir } from '@circi/testing'
import type { FastifyInstance } from 'fastify'
import { pino } from 'pino'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { instanceEnvOf } from '#composition/instance-env.ts'
import { createSsoSync } from '#composition/sso-sync.ts'
import { buildServer } from '#http/app.ts'
import { caller, type Client, JSON_HEADERS, signedInClient } from '#test/support/client.ts'
import { ORIGIN, seedTenant } from '#test/support/helpers.ts'

let t: createTestDb.Result
const tempDir = useTempDir('circi-instance-config')
let app: FastifyInstance
let store: InstanceConfigStore
let idp: Server
let issuer = ''
let admin: Client
let member: Client
const adminUser = { email: 'root@acme.test', password: 'root-password-long-1' }
const memberUser = { email: 'plain@acme.test', password: 'plain-password-long-1' }
const fake = fakeMailer()

const env = {
  DATABASE_URL: 'postgres://localhost/circi',
  BETTER_AUTH_SECRET: TEST_AUTH_SECRET,
  PUBLIC_URL: ORIGIN,
  // Set in the environment: locked in the dashboard.
  GC_GRACE_HOURS: '48',
}
const config = loadConfig(env)

function portOf(server: Server): number {
  const address = server.address()
  if (typeof address !== 'object' || address === null) throw new Error('server is not listening')
  return address.port
}

beforeAll(async () => {
  idp = createServer((req, res) => {
    const base = `http://127.0.0.1:${portOf(idp)}`
    res.setHeader('content-type', 'application/json')
    res.end(
      req.url === '/.well-known/openid-configuration'
        ? JSON.stringify({
            issuer: base,
            authorization_endpoint: `${base}/authorize`,
            token_endpoint: `${base}/token`,
            userinfo_endpoint: `${base}/userinfo`,
            jwks_uri: `${base}/jwks`,
          })
        : '{}',
    )
  })
  await new Promise<void>((resolve) => idp.listen(0, '127.0.0.1', resolve))
  issuer = `http://127.0.0.1:${portOf(idp)}`

  t = await createTestDb()
  store = createInstanceConfig({
    db: t.db,
    authSecret: config.authSecret,
    env: instanceEnvOf(config),
  })
  const mailer: Mailer = {
    configured: async () => (await store.get()).smtp !== undefined,
    send: (mail) => fake.send(mail),
  }
  const syncSso = createSsoSync({ instanceConfig: store, auth: () => auth })
  const auth = createAuth({
    db: t.db,
    secret: config.authSecret,
    baseURL: ORIGIN,
    mailer,
    passwordLogin: async () => (await store.get()).signIn.password,
    refresh: syncSso,
  })
  app = buildServer({
    logger: pino({ level: 'silent' }),
    checks: [],
    dashboard: {
      db: t.db,
      auth,
      storage: new FsStorage({ path: tempDir.path }),
      publicOrigin: ORIGIN,
      instanceConfig: store,
      instance: { config, mailer, fetchHost: async () => undefined },
    },
  })
  await app.ready()
  await createUser(auth, { ...adminUser, name: 'Root', instanceAdmin: true })
  await createUser(auth, { ...memberUser, name: 'Plain' })
  admin = await signedInClient(app, adminUser)
  member = await signedInClient(app, memberUser)
  await seedTenant(auth, t.db)
})
afterAll(async () => {
  await app.close()
  await new Promise((resolve) => idp.close(resolve))
  await t.close()
})

const call = caller(() => app)
const settings = async () =>
  (await admin.get('/api/instance/settings')).json<InstanceAdmin.Settings>().config
const methods = async () =>
  (await app.inject({ url: '/api/auth-methods' })).json<{
    password: boolean
    email: boolean
    sso: { id: string; name: string }[]
  }>()
const otp = () =>
  app.inject({
    method: 'POST',
    url: '/api/auth/email-otp/send-verification-otp',
    headers: JSON_HEADERS,
    payload: { email: memberUser.email, type: 'sign-in' },
  })
const signInStatus = async (email: string, password: string) =>
  (
    await app.inject({
      method: 'POST',
      url: '/api/auth/sign-in/email',
      headers: JSON_HEADERS,
      payload: { email, password },
    })
  ).statusCode

describe('access', () => {
  const routes: ['PUT' | 'DELETE', string, unknown][] = [
    ['PUT', '/api/instance/config/workspace-creation', { value: 'anyone' }],
    ['PUT', '/api/instance/config/sign-in', { password: true }],
    ['PUT', '/api/instance/config/limits', { gcGraceHours: 1 }],
    [
      'PUT',
      '/api/instance/config/smtp',
      { host: 'h', port: 25, secure: false, user: '', from: 'a@b.c' },
    ],
    ['DELETE', '/api/instance/config/smtp', undefined],
    ['PUT', '/api/instance/config/slack', { clientId: 'a', clientSecret: 'b' }],
    ['DELETE', '/api/instance/config/slack', undefined],
    [
      'PUT',
      '/api/instance/config/sso/google',
      { clientId: 'a', clientSecret: 'b', trustedForEmail: true },
    ],
    ['DELETE', '/api/instance/config/sso/google', undefined],
  ]
  it.each(routes)('%s %s: 401 signed out, 403 for a member', async (method, url, body) => {
    expect((await call(method, url, undefined, body)).statusCode).toBe(401)
    expect((await call(method, url, member.cookie, body)).statusCode).toBe(403)
  })
})

describe('workspace creation', () => {
  it('is read per request: a change applies with no restart', async () => {
    const create = () => member.send('POST', '/api/workspaces', { name: 'Initech' })
    expect((await create()).statusCode).toBe(403)
    expect(
      (await member.get('/api/capabilities')).json<{ canCreateWorkspace: boolean }>()
        .canCreateWorkspace,
    ).toBe(false)

    const saved = await admin.send('PUT', '/api/instance/config/workspace-creation', {
      value: 'anyone',
    })
    expect(saved.statusCode).toBe(200)
    expect(saved.json<InstanceAdmin.Config>().workspaceCreation).toEqual({
      value: 'anyone',
      source: 'stored',
      env: null,
    })
    expect((await create()).statusCode).toBe(201)

    await admin.send('PUT', '/api/instance/config/workspace-creation', { value: 'admin' })
    expect((await create()).statusCode).toBe(403)
  })

  it('refuses a value that is not one of the two', async () => {
    expect(
      (await admin.send('PUT', '/api/instance/config/workspace-creation', { value: 'nobody' }))
        .statusCode,
    ).toBe(400)
  })
})

describe('limits', () => {
  it('validates, saves, and refuses what the environment sets', async () => {
    const bad = await admin.send('PUT', '/api/instance/config/limits', {
      defaultProjectRetentionDays: 0,
    })
    expect(bad.statusCode).toBe(400)
    expect(bad.json<{ fields: Record<string, string> }>().fields).toHaveProperty(
      'defaultProjectRetentionDays',
    )
    expect(
      (await admin.send('PUT', '/api/instance/config/limits', { uploadTimeoutMinutes: 1.5 }))
        .statusCode,
    ).toBe(400)
    expect(
      (await admin.send('PUT', '/api/instance/config/limits', { unknown: 1 })).statusCode,
    ).toBe(400)

    const saved = await admin.send('PUT', '/api/instance/config/limits', {
      webhookTimeoutSeconds: 30,
      staticSitesMaxMb: 500,
    })
    expect(saved.statusCode).toBe(200)
    expect(saved.json<InstanceAdmin.Config>().limits).toMatchObject({
      webhookTimeoutSeconds: { value: 30, source: 'stored' },
      staticSitesMaxMb: { value: 500, source: 'stored' },
    })
    expect((await store.get()).limits.webhookTimeoutSeconds).toBe(30)

    // GC_GRACE_HOURS is set: shown as the variable's value and locked.
    expect((await settings()).limits.gcGraceHours).toEqual({
      value: 48,
      source: 'env',
      env: 'GC_GRACE_HOURS',
    })
    const locked = await admin.send('PUT', '/api/instance/config/limits', { gcGraceHours: 1 })
    expect(locked.statusCode).toBe(400)
    expect(locked.body).toContain('GC_GRACE_HOURS')
    expect((await store.get()).limits.gcGraceHours).toBe(48)
  })

  it('applies the default retention to workspaces that have not set their own', async () => {
    await admin.send('PUT', '/api/instance/config/limits', { defaultProjectRetentionDays: 90 })
    const { workspace } = (
      await admin.send('POST', '/api/workspaces', { name: 'Retention test' })
    ).json<{ workspace: { slug: string } }>()
    const row = await t.db.query.workspace.findFirst({
      where: (w, { eq }) => eq(w.slug, workspace.slug),
    })
    expect((await getWorkspaceSettings(t.db, row?.id ?? '')).retentionDays).toBe(90)
  })
})

describe('mail server', () => {
  it('is saved with a write-only password, tested with the test mail, and removed', async () => {
    expect(
      (await admin.send('POST', '/api/instance/mail/test')).json<InstanceAdmin.MailTest>(),
    ).toMatchObject({ ok: false })

    const bad = await admin.send('PUT', '/api/instance/config/smtp', {
      host: 'smtp.acme.io',
      port: 587,
      secure: false,
      user: 'mailer',
      from: 'ci@acme.io',
    })
    expect(bad.statusCode).toBe(400)
    expect(bad.json<{ fields: Record<string, string> }>().fields).toHaveProperty('password')

    const saved = await admin.send('PUT', '/api/instance/config/smtp', {
      host: 'smtp.acme.io',
      port: 587,
      secure: false,
      user: 'mailer',
      from: 'CirCI <ci@acme.io>',
      password: 'smtp-secret-do-not-leak',
    })
    expect(saved.statusCode).toBe(200)
    expect(saved.body).not.toContain('smtp-secret-do-not-leak')
    expect(saved.json<InstanceAdmin.Config>().smtp).toMatchObject({
      source: 'stored',
      env: null,
      host: 'smtp.acme.io',
      passwordSaved: true,
    })
    expect((await admin.get('/api/instance/settings')).body).not.toContain(
      'smtp-secret-do-not-leak',
    )
    expect((await methods()).email).toBe(true)

    fake.sent.length = 0
    expect(
      (await admin.send('POST', '/api/instance/mail/test')).json<InstanceAdmin.MailTest>(),
    ).toMatchObject({ ok: true, to: adminUser.email })
    expect(fake.sent).toHaveLength(1)

    // A change that leaves the password out keeps it.
    const kept = await admin.send('PUT', '/api/instance/config/smtp', {
      host: 'smtp2.acme.io',
      port: 465,
      secure: true,
      user: 'mailer',
      from: 'CirCI <ci@acme.io>',
    })
    expect(kept.json<InstanceAdmin.Config>().smtp).toMatchObject({
      host: 'smtp2.acme.io',
      passwordSaved: true,
    })
    expect((await store.get()).smtp?.auth?.password).toBe('smtp-secret-do-not-leak')

    const removed = await admin.send('DELETE', '/api/instance/config/smtp')
    expect(removed.statusCode).toBe(200)
    expect(removed.json<InstanceAdmin.Config>().smtp.source).toBe('none')
    expect((await methods()).email).toBe(false)
  })
})

describe('Slack app', () => {
  it('is saved with a write-only secret and read by the integration setup', async () => {
    const saved = await admin.send('PUT', '/api/instance/config/slack', {
      clientId: 'slack-client',
      clientSecret: 'slack-secret-do-not-leak',
    })
    expect(saved.statusCode).toBe(200)
    expect(saved.body).not.toContain('slack-secret-do-not-leak')
    expect(saved.json<InstanceAdmin.Config>().slack).toEqual({
      source: 'stored',
      env: null,
      clientId: 'slack-client',
      secretSaved: true,
      unreadable: null,
    })
    expect((await store.get()).slack).toMatchObject({ clientId: 'slack-client' })
    expect(
      (await admin.send('PUT', '/api/instance/config/slack', { clientId: '', clientSecret: 'x' }))
        .statusCode,
    ).toBe(400)
    expect((await admin.send('DELETE', '/api/instance/config/slack')).statusCode).toBe(200)
    expect((await store.get()).slack).toBeUndefined()
  })
})

describe('sign-in methods', () => {
  it('turns password sign-in off and on while running, and refuses the lockout', async () => {
    expect(await signInStatus(memberUser.email, memberUser.password)).toBe(200)
    // Nobody could sign in: no mail server, no provider.
    const lockout = await admin.send('PUT', '/api/instance/config/sign-in', { password: false })
    expect(lockout.statusCode).toBe(409)
    expect(lockout.body).toContain('Nobody could sign in')
    expect(await signInStatus(memberUser.email, memberUser.password)).toBe(200)

    // With a mail server, password can go, but not by an admin who signed in with a password.
    await admin.send('PUT', '/api/instance/config/smtp', {
      host: 'smtp.acme.io',
      port: 587,
      secure: false,
      user: '',
      from: 'ci@acme.io',
    })
    const own = await admin.send('PUT', '/api/instance/config/sign-in', { password: false })
    expect(own.statusCode).toBe(409)
    expect(own.body).toContain("You're signed in with password")
    expect((await methods()).password).toBe(true)

    // The same save from a session that signed in another way (here: no known method) is allowed.
    await store.setSignIn({ password: false })
    expect((await methods()).password).toBe(false)
    expect(await signInStatus(memberUser.email, memberUser.password)).toBe(403)

    await store.setSignIn({ password: true })
    expect(await signInStatus(memberUser.email, memberUser.password)).toBe(200)
    await store.removeSmtp()
  })

  it('offers email codes only while switched on and a mail server is set up', async () => {
    expect((await otp()).statusCode).toBe(404)
    await store.saveSmtp({
      host: 'smtp.acme.io',
      port: 587,
      secure: false,
      user: '',
      from: 'ci@acme.io',
    })
    expect((await otp()).statusCode).toBe(200)
    await admin.send('PUT', '/api/instance/config/sign-in', { email: false })
    expect((await otp()).statusCode).toBe(404)
    await admin.send('PUT', '/api/instance/config/sign-in', { email: true })
    await store.removeSmtp()
  })
})

describe('single sign-on providers', () => {
  it('are added in the dashboard and offered at once, secret write-only', async () => {
    expect((await methods()).sso).toEqual([])
    const saved = await admin.send('PUT', '/api/instance/config/sso/oidc', {
      name: 'Acme SSO',
      clientId: 'oidc-id',
      clientSecret: 'oidc-secret-do-not-leak',
      issuer,
      trustedForEmail: false,
    })
    expect(saved.statusCode).toBe(200)
    expect(saved.body).not.toContain('oidc-secret-do-not-leak')
    expect(saved.json<InstanceAdmin.Config>().sso).toEqual([
      {
        id: 'oidc',
        name: 'Acme SSO',
        clientId: 'oidc-id',
        issuer,
        trustedForEmail: false,
        secretSaved: true,
        source: 'stored',
        unreadable: null,
        env: null,
      },
    ])
    expect((await methods()).sso).toEqual([{ id: 'oidc', name: 'Acme SSO' }])

    // better-auth now sends the browser to the provider, with no restart.
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-in/social',
      headers: JSON_HEADERS,
      payload: JSON.stringify({ provider: 'oidc', callbackURL: '/' }),
    })
    expect(res.statusCode).toBe(200)
    const url = new URL(res.json().url)
    expect(url.origin + url.pathname).toBe(`${issuer}/authorize`)
    expect(url.searchParams.get('client_id')).toBe('oidc-id')
    expect(url.searchParams.get('redirect_uri')).toBe(callbackUrl(ORIGIN, { id: 'oidc' }))

    const github = await admin.send('PUT', '/api/instance/config/sso/github', {
      clientId: 'gh-id',
      clientSecret: 'gh-secret',
      trustedForEmail: true,
    })
    expect(github.statusCode).toBe(200)
    const gh = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-in/social',
      headers: JSON_HEADERS,
      payload: JSON.stringify({ provider: 'github', callbackURL: '/' }),
    })
    expect(new URL(gh.json().url).searchParams.get('client_id')).toBe('gh-id')
  })

  it('stop being offered when removed or when single sign-on is switched off', async () => {
    expect((await admin.send('DELETE', '/api/instance/config/sso/github')).statusCode).toBe(200)
    expect((await methods()).sso.map((p) => p.id)).toEqual(['oidc'])
    const gone = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-in/social',
      headers: JSON_HEADERS,
      payload: JSON.stringify({ provider: 'github', callbackURL: '/' }),
    })
    expect(gone.statusCode).not.toBe(200)

    await admin.send('PUT', '/api/instance/config/sign-in', { sso: false })
    expect((await methods()).sso).toEqual([])
    await admin.send('PUT', '/api/instance/config/sign-in', { sso: true })
    expect((await admin.send('DELETE', '/api/instance/config/sso/oidc')).statusCode).toBe(200)
    expect((await methods()).sso).toEqual([])
  })

  it('validates the fields', async () => {
    const noIssuer = await admin.send('PUT', '/api/instance/config/sso/oidc', {
      clientId: 'a',
      clientSecret: 'b',
      trustedForEmail: false,
    })
    expect(noIssuer.statusCode).toBe(400)
    expect(noIssuer.json<{ fields: Record<string, string> }>().fields).toHaveProperty('issuer')
    expect(
      (
        await admin.send('PUT', '/api/instance/config/sso/github', {
          clientId: 'a',
          trustedForEmail: true,
        })
      ).statusCode,
    ).toBe(400)
    expect(
      (
        await admin.send('PUT', '/api/instance/config/sso/facebook', {
          clientId: 'a',
          clientSecret: 'b',
          trustedForEmail: true,
        })
      ).statusCode,
    ).toBe(400)
  })
})
