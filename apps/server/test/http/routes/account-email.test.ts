import type { Account, InstanceAdmin } from '@circi/api'
import { createUser } from '@circi/auth'
import { loadConfig } from '@circi/config'
import { getAccountEmail } from '@circi/db/queries'
import * as schema from '@circi/db/schema'
import { createTestDb } from '@circi/db/testing'
import { FsStorage } from '@circi/storage'
import { fakeMailer, TEST_AUTH_SECRET, useTempDir } from '@circi/testing'
import { and, eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { pino } from 'pino'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { buildServer } from '#http/app.ts'
import { clientFor } from '#test/support/client.ts'
import { createTestAuth, ORIGIN, seedTenant, signIn } from '#test/support/helpers.ts'

/** Changing your own email (confirmed from the new mailbox) and an instance admin changing someone's. */
let t: createTestDb.Result
const tempDir = useTempDir('circi-email-change')
let withMail: FastifyInstance
let noMail: FastifyInstance
const mailer = fakeMailer()
const env = {
  DATABASE_URL: 'postgres://localhost/circi',
  BETTER_AUTH_SECRET: TEST_AUTH_SECRET,
  PUBLIC_URL: ORIGIN,
  SMTP_HOST: 'smtp.acme.test',
  SMTP_FROM: 'CirCI <ci@acme.test>',
}
const password = 'a-long-password-1234'
let workspaceId: string

async function person(email: string, name = 'Person') {
  const auth = createTestAuth(t.db)
  const user = await createUser(auth, { email, name, password })
  return { id: user.id, email, cookie: await signIn(withMail, email, password) }
}

/** The mail's first link, as a path and query the app can be asked for. */
function linkOf(mail: { text: string }): string {
  const link = mail.text.split('\n').find((line) => line.startsWith(`${ORIGIN}/api/auth/`))
  if (!link) throw new Error('no link in the mail')
  return link.slice(ORIGIN.length)
}

async function mailsTo(address: string, count = 1) {
  await mailer.idle()
  const mails = mailer.sent.filter((m) => m.to === address)
  expect(mails).toHaveLength(count)
  return mails
}

beforeAll(async () => {
  t = await createTestDb()
  const storage = new FsStorage({ path: tempDir.path })
  const auth = createTestAuth(t.db, mailer)
  withMail = buildServer({
    logger: pino({ level: 'silent' }),
    checks: [],
    dashboard: {
      db: t.db,
      auth,
      storage,
      publicOrigin: ORIGIN,
      instance: { config: loadConfig(env), mailer, fetchHost: async () => undefined },
    },
  })
  noMail = buildServer({
    logger: pino({ level: 'silent' }),
    checks: [],
    dashboard: { db: t.db, auth: createTestAuth(t.db), storage, publicOrigin: ORIGIN },
  })
  await Promise.all([withMail.ready(), noMail.ready()])
  const tenant = await seedTenant(auth, t.db)
  workspaceId = (
    await t.db
      .select({ id: schema.workspace.id })
      .from(schema.workspace)
      .where(eq(schema.workspace.slug, tenant.workspaceSlug))
  )[0]!.id
})
afterAll(async () => {
  await Promise.all([withMail.close(), noMail.close()])
  await t.close()
})

describe('changing your own email', () => {
  it('mails the new address a link, tells the old one, and changes nothing until the link is opened', async () => {
    const ann = await person('ann@old.test', 'Ann')
    const as = clientFor(withMail, ann.cookie)
    const res = await as.send('POST', '/api/auth/change-email', {
      newEmail: 'Ann@New.test',
      callbackURL: '/account/profile',
    })
    expect(res.statusCode).toBe(200)

    const [confirm] = await mailsTo('ann@new.test')
    expect(confirm?.subject).toBe('Confirm your new CirCI email address')
    expect(confirm?.text).toContain('from ann@old.test')
    const [notice] = await mailsTo('ann@old.test')
    expect(notice?.subject).toBe('Someone asked to change your CirCI email address')
    expect(notice?.text).toContain('ann@new.test')
    expect(notice?.text).not.toContain('/api/auth/verify-email')

    expect(await getAccountEmail(t.db, ann.id)).toBe('ann@old.test')
    expect((await as.get('/api/account/email-change')).json<Account.EmailChange>()).toEqual({
      pendingEmail: 'ann@new.test',
    })

    const opened = await as.get(linkOf(confirm!))
    expect(opened.statusCode).toBe(302)
    expect(opened.headers.location).toBe('/account/profile')
    expect(await getAccountEmail(t.db, ann.id)).toBe('ann@new.test')
    expect((await as.get('/api/account/email-change')).json<Account.EmailChange>()).toEqual({
      pendingEmail: null,
    })
  })

  it('answers an address another account uses with its own message, and sends nothing', async () => {
    const bea = await person('bea@old.test')
    await person('taken@old.test')
    const before = mailer.sent.length
    const res = await clientFor(withMail, bea.cookie).send('POST', '/api/auth/change-email', {
      newEmail: 'Taken@old.test',
    })
    expect(res.statusCode).toBe(400)
    expect(res.json<{ message: string }>().message).toBe('That email address is already in use')
    await mailer.idle()
    expect(mailer.sent).toHaveLength(before)
  })

  it('refuses an address that is not one, and the one the account has', async () => {
    const cy = await person('cy@old.test')
    const as = clientFor(withMail, cy.cookie)
    expect((await as.send('POST', '/api/auth/change-email', { newEmail: 'nope' })).statusCode).toBe(
      400,
    )
    expect(
      (await as.send('POST', '/api/auth/change-email', { newEmail: 'cy@old.test' })).statusCode,
    ).toBe(400)
  })

  it('needs mail: without it the request is refused, and an admin has to do it', async () => {
    const auth = createTestAuth(t.db)
    await createUser(auth, { email: 'dov@old.test', name: 'Dov', password })
    const cookie = await signIn(noMail, 'dov@old.test', password)
    const res = await clientFor(noMail, cookie).send('POST', '/api/auth/change-email', {
      newEmail: 'dov@new.test',
    })
    expect(res.statusCode).toBe(400)
    expect(res.json<{ message: string }>().message).toContain('instance admin')
  })

  it("doesn't change anything when the link is opened without a session", async () => {
    const eli = await person('eli@old.test')
    await clientFor(withMail, eli.cookie).send('POST', '/api/auth/change-email', {
      newEmail: 'eli@new.test',
    })
    const [confirm] = await mailsTo('eli@new.test')
    const res = await clientFor(withMail).get(linkOf(confirm!))
    expect(res.statusCode).toBe(302)
    expect(res.headers.location).toBe('/')
    expect(await getAccountEmail(t.db, eli.id)).toBe('eli@old.test')
  })

  it('keeps every membership and joins the workspaces that verified the new domain', async () => {
    const fay = await person('fay@kept.test')
    await t.db.insert(schema.member).values({
      id: 'member-fay-kept',
      workspaceId,
      userId: fay.id,
      role: 'member',
      createdAt: new Date(),
    })
    const tenant2 = await seedTenant(createTestAuth(t.db), t.db)
    const [second] = await t.db
      .select({ id: schema.workspace.id })
      .from(schema.workspace)
      .where(eq(schema.workspace.slug, tenant2.workspaceSlug))
    await t.db.insert(schema.workspaceDomains).values({
      workspaceId: second!.id,
      domain: 'joined.test',
      verificationToken: 'token',
      verifiedAt: new Date(),
    })
    const as = clientFor(withMail, fay.cookie)
    await as.send('POST', '/api/auth/change-email', { newEmail: 'fay@joined.test' })
    const [confirm] = await mailsTo('fay@joined.test')
    await as.get(linkOf(confirm!))

    const rows = await t.db
      .select({ workspaceId: schema.member.workspaceId })
      .from(schema.member)
      .where(eq(schema.member.userId, fay.id))
    expect(rows.map((r) => r.workspaceId).toSorted()).toEqual([workspaceId, second!.id].toSorted())
  })
})

describe('an instance admin changing an email', () => {
  it('sets it at once with no mail, and refuses an address in use, a non-address and non-admins', async () => {
    const auth = createTestAuth(t.db, mailer)
    await createUser(auth, {
      email: 'root@acme.test',
      name: 'Root',
      password,
      instanceAdmin: true,
    })
    const adminAs = clientFor(withMail, await signIn(withMail, 'root@acme.test', password))
    const gus = await person('gus@old.test', 'Gus')
    const hal = await person('hal@old.test', 'Hal')
    const before = mailer.sent.length

    const ok = await adminAs.send('POST', `/api/instance/accounts/${gus.id}/email`, {
      email: ' Gus@Moved.test ',
    })
    expect(ok.statusCode).toBe(200)
    const body = ok.json<InstanceAdmin.EmailChanged>()
    expect(body.account.email).toBe('gus@moved.test')
    expect(body.previousEmail).toBe('gus@old.test')
    expect(await getAccountEmail(t.db, gus.id)).toBe('gus@moved.test')
    await mailer.idle()
    expect(mailer.sent).toHaveLength(before)

    const taken = await adminAs.send('POST', `/api/instance/accounts/${gus.id}/email`, {
      email: 'hal@old.test',
    })
    expect(taken.statusCode).toBe(409)
    const invalid = await adminAs.send('POST', `/api/instance/accounts/${gus.id}/email`, {
      email: 'nope',
    })
    expect(invalid.statusCode).toBe(400)
    const missing = await adminAs.send('POST', '/api/instance/accounts/nobody/email', {
      email: 'x@y.test',
    })
    expect(missing.statusCode).toBe(404)

    const notAdmin = await clientFor(withMail, hal.cookie).send(
      'POST',
      `/api/instance/accounts/${gus.id}/email`,
      { email: 'again@moved.test' },
    )
    expect(notAdmin.statusCode).toBe(403)
    const rows = await t.db
      .select({ email: schema.user.email })
      .from(schema.user)
      .where(and(eq(schema.user.id, gus.id)))
    expect(rows[0]?.email).toBe('gus@moved.test')
  })
})
