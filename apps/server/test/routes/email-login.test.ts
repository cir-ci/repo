import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { Mail } from '@circi/auth'
import { FsStorage } from '@circi/storage'
import type { FastifyInstance } from 'fastify'
import { pino } from 'pino'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { createTestDb, type TestDb } from '../../../../packages/db/test/helpers.ts'
import { buildServer } from '../../src/http/app.ts'
import { createTestAuth, ORIGIN, seedTenant, signIn, type Tenant } from '../helpers.ts'

let t: TestDb
let dir: string
let tenant: Tenant
const sent: Mail[] = []
let on: FastifyInstance
let off: FastifyInstance

const json = { origin: ORIGIN, 'content-type': 'application/json' }

beforeAll(async () => {
  t = await createTestDb()
  dir = await mkdtemp(join(tmpdir(), 'circi-email-'))
  const storage = new FsStorage({ path: dir })
  const mailer = {
    send: async (mail: Mail) => {
      sent.push(mail)
    },
  }
  const auth = createTestAuth(t.db, mailer)
  const deps = { db: t.db, auth, storage, publicOrigin: ORIGIN }
  on = buildServer({
    logger: pino({ level: 'silent' }),
    checks: [],
    dashboard: { ...deps, emailLogin: true },
  })
  off = buildServer({ logger: pino({ level: 'silent' }), checks: [], dashboard: deps })
  await Promise.all([on.ready(), off.ready()])
  tenant = await seedTenant(auth, t.db)
})
afterAll(async () => {
  await Promise.all([on.close(), off.close()])
  await t.close()
  await rm(dir, { recursive: true, force: true })
})

const requestCode = (app: FastifyInstance, email: string) =>
  app.inject({
    method: 'POST',
    url: '/api/auth/email-otp/send-verification-otp',
    headers: json,
    payload: { email, type: 'sign-in' },
  })

const signInWithCode = (app: FastifyInstance, email: string, otp: string) =>
  app.inject({
    method: 'POST',
    url: '/api/auth/sign-in/email-otp',
    headers: json,
    payload: { email, otp },
  })

function codeOf(mail: Mail | undefined): string {
  const code = /sign-in code is (\d{6})/.exec(mail?.text ?? '')?.[1]
  if (!code) throw new Error('no code in the mail')
  return code
}

describe('email login', () => {
  it('tells the sign-in page which methods exist', async () => {
    expect((await on.inject({ url: '/api/auth-methods' })).json()).toEqual({
      password: true,
      email: true,
    })
    expect((await off.inject({ url: '/api/auth-methods' })).json()).toEqual({
      password: true,
      email: false,
    })
  })

  it('mails a code and a fragment link, and the code signs the person in', async () => {
    sent.length = 0
    expect((await requestCode(on, tenant.owner.email)).statusCode).toBe(200)
    await vi.waitFor(() => expect(sent).toHaveLength(1))
    const [mail] = sent
    expect(mail?.to).toBe(tenant.owner.email)
    expect(mail?.text).toContain(
      `${ORIGIN}/#signin-email=${encodeURIComponent(tenant.owner.email)}&code=`,
    )

    const res = await signInWithCode(on, tenant.owner.email, codeOf(mail))
    expect(res.statusCode).toBe(200)
    const cookie = [res.headers['set-cookie']]
      .flat()
      .map((c) => String(c).split(';')[0])
      .join('; ')
    const me = await on.inject({ url: '/api/projects', headers: { cookie } })
    expect(me.statusCode).toBe(200)
    // Signing in with a code must not cost an operator-created account its password.
    await signIn(on, tenant.owner.email, tenant.owner.password)
  })

  it('a code works once', async () => {
    sent.length = 0
    await requestCode(on, tenant.owner.email)
    await vi.waitFor(() => expect(sent).toHaveLength(1))
    const code = codeOf(sent[0])
    expect((await signInWithCode(on, tenant.owner.email, code)).statusCode).toBe(200)
    expect((await signInWithCode(on, tenant.owner.email, code)).statusCode).not.toBe(200)
  })

  it('locks a code after 5 wrong attempts', async () => {
    sent.length = 0
    await requestCode(on, tenant.owner.email)
    await vi.waitFor(() => expect(sent).toHaveLength(1))
    const code = codeOf(sent[0])
    const wrong = code === '000000' ? '111111' : '000000'
    for (let i = 0; i < 5; i++) {
      // oxlint-disable-next-line no-await-in-loop -- attempts are counted in order
      expect((await signInWithCode(on, tenant.owner.email, wrong)).statusCode).not.toBe(200)
    }
    expect((await signInWithCode(on, tenant.owner.email, code)).statusCode).not.toBe(200)
  })

  it('answers the same for unknown addresses, and sends them nothing', async () => {
    sent.length = 0
    const known = await requestCode(on, tenant.owner.email)
    const unknown = await requestCode(on, 'nobody@acme.test')
    expect(unknown.statusCode).toBe(known.statusCode)
    await vi.waitFor(() => expect(sent).toHaveLength(1))
    expect(sent.map((m) => m.to)).toEqual([tenant.owner.email])
    // And no account was created for them.
    expect((await signInWithCode(on, 'nobody@acme.test', '123456')).statusCode).not.toBe(200)
  })

  it('has no email-code endpoints when switched off', async () => {
    expect((await requestCode(off, tenant.owner.email)).statusCode).toBe(404)
    expect((await signInWithCode(off, tenant.owner.email, '123456')).statusCode).toBe(404)
  })
})

const cookieOf = (res: { headers: Record<string, unknown> }) =>
  [res.headers['set-cookie']]
    .flat()
    .map((c) => String(c).split(';')[0])
    .join('; ')

async function invite(email: string, role = 'member') {
  const ownerCookie = await signIn(on, tenant.owner.email, tenant.owner.password)
  const org = await on.inject({
    method: 'GET',
    url: '/api/auth/organization/get-full-organization',
    headers: { cookie: ownerCookie, origin: ORIGIN },
    query: { organizationSlug: tenant.orgSlug },
  })
  sent.length = 0
  const res = await on.inject({
    method: 'POST',
    url: '/api/auth/organization/invite-member',
    headers: { cookie: ownerCookie, ...json },
    payload: { email, role, organizationId: org.json().id },
  })
  expect(res.statusCode).toBe(200)
  await vi.waitFor(() => expect(sent).toHaveLength(1))
  return { invitationId: String(res.json().id), mail: sent[0] }
}

describe('invitations', () => {
  it('lets someone without an account join: the mailed code creates it, then they accept', async () => {
    const email = 'newcomer@acme.test'
    const { invitationId, mail } = await invite(email)
    expect(mail?.to).toBe(email)
    expect(mail?.text).toContain(`${ORIGIN}/#invite=${invitationId}&email=`)

    sent.length = 0
    await requestCode(on, email)
    await vi.waitFor(() => expect(sent).toHaveLength(1))
    const res = await signInWithCode(on, email, codeOf(sent[0]))
    expect(res.statusCode).toBe(200)
    const cookie = cookieOf(res)

    const before = await on.inject({ url: '/api/projects', headers: { cookie } })
    expect(before.json().projects).toHaveLength(0)
    const accepted = await on.inject({
      method: 'POST',
      url: '/api/auth/organization/accept-invitation',
      headers: { cookie, ...json },
      payload: { invitationId },
    })
    expect(accepted.statusCode).toBe(200)
    const after = await on.inject({ url: '/api/projects', headers: { cookie } })
    expect(after.json().projects).toHaveLength(1)
  })

  it('does not let another address use the invitation', async () => {
    const { invitationId } = await invite('invitee@acme.test')
    const other = await seedTenant(createTestAuth(t.db), t.db)
    const cookie = await signIn(on, other.owner.email, other.owner.password)
    const res = await on.inject({
      method: 'POST',
      url: '/api/auth/organization/accept-invitation',
      headers: { cookie, ...json },
      payload: { invitationId },
    })
    expect(res.statusCode).not.toBe(200)
  })

  it('still creates no account for an address nobody invited', async () => {
    sent.length = 0
    await requestCode(on, 'stranger@acme.test')
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(sent).toHaveLength(0)
    expect((await signInWithCode(on, 'stranger@acme.test', '123456')).statusCode).not.toBe(200)
  })
})
