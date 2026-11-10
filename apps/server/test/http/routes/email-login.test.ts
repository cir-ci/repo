import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { Mailer } from '@circi/auth'
import * as schema from '@circi/db/schema'
import { createTestDb } from '@circi/db/testing'
import { FsStorage } from '@circi/storage'
import { eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { pino } from 'pino'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { buildServer } from '#http/app.ts'
import { JSON_HEADERS } from '#test/support/client.ts'
import { createTestAuth, ORIGIN, seedTenant, signIn, type Tenant } from '#test/support/helpers.ts'

let t: createTestDb.Result
let dir: string
let tenant: Tenant
const sent: Mailer.Mail[] = []
let on: FastifyInstance
let off: FastifyInstance

beforeAll(async () => {
  t = await createTestDb()
  dir = await mkdtemp(join(tmpdir(), 'circi-email-'))
  const storage = new FsStorage({ path: dir })
  const mailer = {
    send: async (mail: Mailer.Mail) => {
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
    headers: JSON_HEADERS,
    payload: { email, type: 'sign-in' },
  })

const signInWithCode = (app: FastifyInstance, email: string, otp: string) =>
  app.inject({
    method: 'POST',
    url: '/api/auth/sign-in/email-otp',
    headers: JSON_HEADERS,
    payload: { email, otp },
  })

function codeOf(mail: Mailer.Mail | undefined): string {
  const code = /sign-in code is (\d{6})/.exec(mail?.text ?? '')?.[1]
  if (!code) throw new Error('no code in the mail')
  return code
}

describe('email login', () => {
  it('tells the sign-in page which methods exist', async () => {
    expect((await on.inject({ url: '/api/auth-methods' })).json()).toEqual({
      password: true,
      email: true,
      sso: [],
    })
    expect((await off.inject({ url: '/api/auth-methods' })).json()).toEqual({
      password: true,
      email: false,
      sso: [],
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
    const me = await on.inject({ url: '/api/teams', headers: { cookie } })
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

  it('sends a banned account no code, answering exactly as for anyone else', async () => {
    const banned = await seedTenant(createTestAuth(t.db), t.db)
    await t.db
      .update(schema.user)
      .set({ banned: true, banExpires: null })
      .where(eq(schema.user.email, banned.owner.email))
    sent.length = 0
    const known = await requestCode(on, tenant.owner.email)
    const ban = await requestCode(on, banned.owner.email)
    expect(ban.statusCode).toBe(known.statusCode)
    expect(ban.json()).toEqual(known.json())
    await vi.waitFor(() => expect(sent).toHaveLength(1))
    expect(sent.map((m) => m.to)).toEqual([tenant.owner.email])
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
  const workspace = await on.inject({
    method: 'GET',
    url: '/api/auth/organization/get-full-organization',
    headers: { cookie: ownerCookie, origin: ORIGIN },
    query: { organizationSlug: tenant.workspaceSlug },
  })
  sent.length = 0
  const res = await on.inject({
    method: 'POST',
    url: '/api/auth/organization/invite-member',
    headers: { cookie: ownerCookie, ...JSON_HEADERS },
    payload: { email, role, organizationId: workspace.json().id },
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

    const before = await on.inject({ url: '/api/teams', headers: { cookie } })
    expect(before.json().teams).toHaveLength(0)
    const accepted = await on.inject({
      method: 'POST',
      url: '/api/auth/organization/accept-invitation',
      headers: { cookie, ...JSON_HEADERS },
      payload: { invitationId },
    })
    expect(accepted.statusCode).toBe(200)
    // Accepting joins the workspace and no team.
    const after = await on.inject({
      url: `/api/workspaces/${tenant.workspaceSlug}/sidebar`,
      headers: { cookie },
    })
    expect(after.statusCode).toBe(200)
    expect(after.json().teams).toEqual([])
  })

  it('does not let another address use the invitation', async () => {
    const { invitationId } = await invite('invitee@acme.test')
    const other = await seedTenant(createTestAuth(t.db), t.db)
    const cookie = await signIn(on, other.owner.email, other.owner.password)
    const res = await on.inject({
      method: 'POST',
      url: '/api/auth/organization/accept-invitation',
      headers: { cookie, ...JSON_HEADERS },
      payload: { invitationId },
    })
    expect(res.statusCode).not.toBe(200)
  })

  it('still creates no account for an address nobody invited', async () => {
    sent.length = 0
    await requestCode(on, 'stranger@acme.test')
    // The mail (if any) is sent before the request is answered, so nothing is still to come.
    expect(sent).toHaveLength(0)
    expect((await signInWithCode(on, 'stranger@acme.test', '123456')).statusCode).not.toBe(200)
  })
})

const signInFrom = (userAgent: string) =>
  on.inject({
    method: 'POST',
    url: '/api/auth/sign-in/email',
    headers: { ...JSON_HEADERS, 'user-agent': userAgent },
    payload: { email: tenant.owner.email, password: tenant.owner.password },
  })

const newSignInMails = () => sent.filter((m) => m.subject.startsWith('New sign-in'))

describe('abuse limits and new-device mail', () => {
  it('stops one address being flooded with codes, even from different IPs', async () => {
    const email = 'flood@acme.test'
    const statuses: number[] = []
    for (let i = 0; i < 7; i += 1) {
      // eslint-disable-next-line no-await-in-loop -- order matters
      const res = await on.inject({
        method: 'POST',
        url: '/api/auth/email-otp/send-verification-otp',
        headers: { ...JSON_HEADERS, 'x-forwarded-for': `203.0.113.${i + 1}` },
        payload: { email, type: 'sign-in' },
      })
      statuses.push(res.statusCode)
    }
    // No account behind this address, and it's limited all the same: the limit leaks nothing.
    expect(statuses).toEqual([200, 200, 200, 200, 200, 429, 429])
  })

  it('mails the owner once per browser the account has not been used from before', async () => {
    // The account has been used before, from the default test client.
    await signIn(on, tenant.owner.email, tenant.owner.password)
    sent.length = 0
    expect((await signInFrom('Firefox/130 (Macintosh)')).statusCode).toBe(200)
    await vi.waitFor(() => expect(newSignInMails()).toHaveLength(1))
    const mail = newSignInMails()[0]
    expect(mail?.to).toBe(tenant.owner.email)
    expect(mail?.text).toContain('Firefox/130 (Macintosh)')
    expect(mail?.text).toContain('Profile and sessions')

    // The same browser again: nothing more. A different one: another mail.
    expect((await signInFrom('Firefox/130 (Macintosh)')).statusCode).toBe(200)
    expect((await signInFrom('Safari/17 (iPhone)')).statusCode).toBe(200)
    await vi.waitFor(() => expect(newSignInMails()).toHaveLength(2))
    expect(newSignInMails()[1]?.text).toContain('Safari/17 (iPhone)')
  })
})
