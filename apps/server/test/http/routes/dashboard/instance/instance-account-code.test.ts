import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { InstanceAdmin, Workspace } from '@circi/api'
import { createUser, type Mailer } from '@circi/auth'
import { loadConfig } from '@circi/config'
import * as schema from '@circi/db/schema'
import { FsStorage } from '@circi/storage'
import { createTestDb } from '@circi/testing'
import { eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { pino } from 'pino'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { buildServer } from '#http/app.ts'
import { clientFor, JSON_HEADERS } from '#test/support/client.ts'
import { createTestAuth, ORIGIN, signIn } from '#test/support/helpers.ts'

/** "Email a sign-in code" when an admin creates an account. SMTP is a fake mailer. */
let t: createTestDb.Result
let dir: string
let withMail: FastifyInstance
let noMail: FastifyInstance
let adminCookie: string
let noMailAdminCookie: string
const sent: Mailer.Mail[] = []
const mailer: Mailer = { send: async (mail) => void sent.push(mail) }
const env = {
  DATABASE_URL: 'postgres://localhost/circi',
  BETTER_AUTH_SECRET: 'test-secret-that-is-long-enough-1234',
  PUBLIC_URL: ORIGIN,
  SMTP_HOST: 'smtp.acme.test',
  SMTP_FROM: 'CirCI <ci@acme.test>',
}
const admin = { email: 'root@acme.test', password: 'root-password-long-1' }

beforeAll(async () => {
  t = await createTestDb()
  dir = await mkdtemp(join(tmpdir(), 'circi-code-'))
  const storage = new FsStorage({ path: dir })
  const authWithMail = createTestAuth(t.db, mailer)
  withMail = buildServer({
    logger: pino({ level: 'silent' }),
    checks: [],
    dashboard: {
      db: t.db,
      auth: authWithMail,
      storage,
      publicOrigin: ORIGIN,
      emailLogin: true,
      instance: { config: loadConfig(env), mailer, fetchHost: async () => undefined },
    },
  })
  const authNoMail = createTestAuth(t.db)
  noMail = buildServer({
    logger: pino({ level: 'silent' }),
    checks: [],
    dashboard: { db: t.db, auth: authNoMail, storage, publicOrigin: ORIGIN },
  })
  await Promise.all([withMail.ready(), noMail.ready()])
  await createUser(authWithMail, { ...admin, name: 'Root', instanceAdmin: true })
  adminCookie = await signIn(withMail, admin.email, admin.password)
  noMailAdminCookie = await signIn(noMail, admin.email, admin.password)
})
afterAll(async () => {
  await Promise.all([withMail.close(), noMail.close()])
  await t.close()
  await rm(dir, { recursive: true, force: true })
})

const caps = async (app: FastifyInstance, cookie: string) =>
  (
    await app.inject({ url: '/api/capabilities', headers: { cookie } })
  ).json<Workspace.Capabilities>()

describe('creating an account that signs in with an emailed code', () => {
  it('tells the web whether the instance can send mail', async () => {
    expect((await caps(withMail, adminCookie)).mailConfigured).toBe(true)
    expect((await caps(noMail, noMailAdminCookie)).mailConfigured).toBe(false)
  })

  it('creates the account without a password, mails the code, and the code signs the person in', async () => {
    sent.length = 0
    const res = await clientFor(withMail, adminCookie).send('POST', '/api/instance/accounts', {
      email: 'newcomer@acme.test',
      name: 'Newcomer',
      signInCode: true,
    })
    expect(res.statusCode).toBe(201)
    expect(res.json<InstanceAdmin.CreatedAccount>()).toMatchObject({
      password: null,
      signInCodeSentTo: 'newcomer@acme.test',
      account: { email: 'newcomer@acme.test' },
    })
    // No credential at all: a password can never sign this account in.
    const [user] = await t.db
      .select()
      .from(schema.user)
      .where(eq(schema.user.email, 'newcomer@acme.test'))
    expect(
      await t.db
        .select()
        .from(schema.account)
        .where(eq(schema.account.userId, user?.id ?? '')),
    ).toEqual([])

    // The mail is the same one "Email me a code" sends.
    await vi.waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0]?.to).toBe('newcomer@acme.test')
    const otp = /sign-in code is (\d{6})/.exec(sent[0]?.text ?? '')?.[1]
    expect(otp).toBeDefined()
    const signedIn = await withMail.inject({
      method: 'POST',
      url: '/api/auth/sign-in/email-otp',
      headers: JSON_HEADERS,
      payload: { email: 'newcomer@acme.test', otp },
    })
    expect(signedIn.statusCode).toBe(200)
    const cookie = [signedIn.headers['set-cookie']]
      .flat()
      .map((c) => String(c).split(';')[0])
      .join('; ')
    expect(
      (await withMail.inject({ url: '/api/capabilities', headers: { cookie } })).statusCode,
    ).toBe(200)
    // And the same code is single use.
    const again = await withMail.inject({
      method: 'POST',
      url: '/api/auth/sign-in/email-otp',
      headers: JSON_HEADERS,
      payload: { email: 'newcomer@acme.test', otp },
    })
    expect(again.statusCode).toBeGreaterThanOrEqual(400)
  })

  it('is refused without mail, and not together with a password', async () => {
    const refused = await clientFor(noMail, noMailAdminCookie).send(
      'POST',
      '/api/instance/accounts',
      {
        email: 'nomail@acme.test',
        name: 'No Mail',
        signInCode: true,
      },
    )
    expect(refused.statusCode).toBe(409)
    const both = await clientFor(withMail, adminCookie).send('POST', '/api/instance/accounts', {
      email: 'both@acme.test',
      name: 'Both',
      signInCode: true,
      password: 'a-long-enough-password-1',
    })
    expect(both.statusCode).toBe(400)
  })

  it('leaves the password path as it was', async () => {
    const res = await clientFor(withMail, adminCookie).send('POST', '/api/instance/accounts', {
      email: 'pw@acme.test',
      name: 'Password',
    })
    expect(res.statusCode).toBe(201)
    const body = res.json<InstanceAdmin.CreatedAccount>()
    expect(body.password).toEqual(expect.any(String))
    expect(body.signInCodeSentTo).toBeUndefined()
    expect((await signIn(withMail, 'pw@acme.test', body.password ?? '')).length).toBeGreaterThan(0)
  })
})
