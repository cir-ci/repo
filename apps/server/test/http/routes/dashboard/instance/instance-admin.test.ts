import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { InstanceAdmin } from '@circi/api'
import { createUser, type Mailer } from '@circi/auth'
import { loadConfig } from '@circi/config'
import { enqueueJob, QUEUES } from '@circi/db/queue'
import * as schema from '@circi/db/schema'
import { createTestDb } from '@circi/db/testing'
import { FsStorage } from '@circi/storage'
import { eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { pino } from 'pino'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { instanceProbes } from '#composition/doctor-probes.ts'
import { runDoctor } from '#composition/doctor.ts'
import { buildServer } from '#http/app.ts'
import { caller } from '#test/support/client.ts'
import { createTestAuth, ORIGIN, seedTenant, signIn } from '#test/support/helpers.ts'

let t: createTestDb.Result
let dir: string
let app: FastifyInstance
let adminCookie: string
let memberCookie: string
const admin = { email: 'root@acme.test', password: 'root-password-long-1' }
const member = { email: 'plain@acme.test', password: 'plain-password-long-1' }
const sent: Mailer.Mail[] = []
let mailFails = false
const mailer: Mailer = {
  send: async (mail) => {
    if (mailFails) throw new Error('connection refused')
    sent.push(mail)
  },
}
const env = {
  DATABASE_URL: 'postgres://localhost/circi',
  BETTER_AUTH_SECRET: 'test-secret-that-is-long-enough-1234',
  PUBLIC_URL: ORIGIN,
  SMTP_HOST: 'smtp.acme.test',
  SMTP_USER: 'mailer-login',
  SMTP_PASSWORD: 'smtp-secret-do-not-leak',
  SMTP_FROM: 'CirCI <ci@acme.test>',
}
const config = loadConfig(env)
const fetchHost = async () => undefined

beforeAll(async () => {
  t = await createTestDb()
  dir = await mkdtemp(join(tmpdir(), 'circi-instance-'))
  const auth = createTestAuth(t.db)
  app = buildServer({
    logger: pino({ level: 'silent' }),
    checks: [],
    dashboard: {
      db: t.db,
      auth,
      storage: new FsStorage({ path: dir }),
      publicOrigin: ORIGIN,
      instance: { config, mailer, fetchHost },
    },
  })
  await app.ready()
  await createUser(auth, { ...admin, name: 'Root', instanceAdmin: true })
  await createUser(auth, { ...member, name: 'Plain' })
  adminCookie = await signIn(app, admin.email, admin.password)
  memberCookie = await signIn(app, member.email, member.password)
  await seedTenant(auth, t.db)
})
afterAll(async () => {
  await app.close()
  await t.close()
  await rm(dir, { recursive: true, force: true })
})

const call = caller(() => app)

const asAdmin = (method: 'GET' | 'PATCH' | 'POST', url: string, body?: unknown) =>
  call(method, url, adminCookie, body)

async function accountByEmail(email: string): Promise<InstanceAdmin.Account> {
  const res = await asAdmin('GET', `/api/instance/accounts?q=${encodeURIComponent(email)}`)
  const found = res.json<InstanceAdmin.AccountList>().accounts.find((a) => a.email === email)
  if (!found) throw new Error(`no account ${email}`)
  return found
}

const signInStatus = async (email: string, password: string) =>
  (
    await app.inject({
      method: 'POST',
      url: '/api/auth/sign-in/email',
      headers: { origin: ORIGIN, 'content-type': 'application/json' },
      payload: { email, password },
    })
  ).statusCode

describe('access', () => {
  const routes: ['GET' | 'POST', string][] = [
    ['GET', '/api/instance/accounts'],
    ['POST', '/api/instance/accounts'],
    ['GET', '/api/instance/workspaces'],
    ['POST', '/api/instance/workspaces'],
    ['GET', '/api/instance/settings'],
    ['POST', '/api/instance/mail/test'],
    ['GET', '/api/instance/health/checks'],
    ['GET', '/api/instance/health/address-checklist'],
    ['GET', '/api/instance/health/queues'],
  ]
  it.each(routes)('%s %s: 401 signed out, 403 for a member', async (method, url) => {
    expect((await call(method, url, undefined, {})).statusCode).toBe(401)
    expect((await call(method, url, memberCookie, {})).statusCode).toBe(403)
  })
})

describe('accounts', () => {
  it('lists with search, paging, role, workspace count and last sign-in', async () => {
    const all = (await asAdmin('GET', '/api/instance/accounts')).json<InstanceAdmin.AccountList>()
    expect(all.total).toBeGreaterThanOrEqual(3)
    const root = all.accounts.find((a) => a.email === admin.email)
    expect(root).toMatchObject({ instanceAdmin: true, banned: false, workspaceCount: 0 })
    expect(root?.lastSignInAt).not.toBeNull()
    const owner = all.accounts.find((a) => a.email.startsWith('owner'))
    expect(owner?.workspaceCount).toBe(1)

    const found = await accountByEmail(member.email)
    expect(found).toMatchObject({ name: 'Plain', instanceAdmin: false })
    const paged = (
      await asAdmin('GET', '/api/instance/accounts?pageSize=1&page=2')
    ).json<InstanceAdmin.AccountList>()
    expect(paged.accounts).toHaveLength(1)
    expect(paged.total).toBe(all.total)
    expect((await asAdmin('GET', '/api/instance/accounts?page=0')).statusCode).toBe(400)
  })

  it('refuses a blank or oversized name in plain words, naming the field', async () => {
    for (const name of ['', '   ', 'x'.repeat(101)]) {
      // oxlint-disable-next-line no-await-in-loop -- tiny fixed list
      const res = await asAdmin('POST', '/api/instance/accounts', { email: 'n@acme.test', name })
      expect(res.statusCode).toBe(400)
      expect(res.json().error).not.toContain('expected')
      expect(res.json().fields.name).toEqual(expect.any(String))
    }
  })

  it('creates an account with a one-time password, or with the one the admin chose', async () => {
    const res = await asAdmin('POST', '/api/instance/accounts', {
      email: 'New.Person@acme.test',
      name: 'New Person',
    })
    expect(res.statusCode).toBe(201)
    const created = res.json<InstanceAdmin.CreatedAccount>()
    expect(created.account.email).toBe('new.person@acme.test')
    expect(created.password).toEqual(expect.any(String))
    expect(await signInStatus('new.person@acme.test', created.password ?? '')).toBe(200)

    const chosen = await asAdmin('POST', '/api/instance/accounts', {
      email: 'chosen@acme.test',
      name: 'Chosen',
      password: 'chosen-password-long-1',
      instanceAdmin: true,
    })
    expect(chosen.json<InstanceAdmin.CreatedAccount>()).toMatchObject({
      password: null,
      account: { instanceAdmin: true },
    })
    expect(await signInStatus('chosen@acme.test', 'chosen-password-long-1')).toBe(200)
    expect(
      (
        await asAdmin('POST', '/api/instance/accounts', {
          email: 'x@acme.test',
          name: 'X',
          password: 'short',
        })
      ).statusCode,
    ).toBe(400)
  })

  it('resets a password: shown once, stored hashed, old one and old sessions stop working', async () => {
    const email = 'reset@acme.test'
    const oldPassword = 'old-password-long-12'
    await asAdmin('POST', '/api/instance/accounts', { email, name: 'Reset', password: oldPassword })
    const oldCookie = await signIn(app, email, oldPassword)
    expect((await call('GET', '/api/capabilities', oldCookie)).statusCode).toBe(200)

    const account = await accountByEmail(email)
    const res = await asAdmin('POST', `/api/instance/accounts/${account.id}/reset-password`, {})
    expect(res.statusCode).toBe(200)
    const { password } = res.json<InstanceAdmin.PasswordReset>()
    expect(password.length).toBeGreaterThanOrEqual(12)

    const [row] = await t.db
      .select({ password: schema.account.password })
      .from(schema.account)
      .where(eq(schema.account.userId, account.id))
    expect(row?.password).toBeTruthy()
    expect(row?.password).not.toContain(password)

    expect(await signInStatus(email, oldPassword)).toBe(401)
    expect(await signInStatus(email, password)).toBe(200)
    expect((await call('GET', '/api/capabilities', oldCookie)).statusCode).toBe(401)
    // Nothing later returns it.
    expect((await accountByEmail(email)) as object).not.toHaveProperty('password')
    expect(
      (await asAdmin('POST', '/api/instance/accounts/nope/reset-password', {})).statusCode,
    ).toBe(404)
  })

  it('bans (with a reason) and unbans; a ban blocks sign-in and ends sessions', async () => {
    const email = 'banned@acme.test'
    const password = 'banned-password-long-1'
    await asAdmin('POST', '/api/instance/accounts', { email, name: 'Banned', password })
    const cookie = await signIn(app, email, password)
    const { id } = await accountByEmail(email)

    const ban = await asAdmin('POST', `/api/instance/accounts/${id}/ban`, {
      reason: 'left the company',
    })
    expect(ban.statusCode).toBe(200)
    expect(ban.json<{ account: InstanceAdmin.Account }>().account).toMatchObject({
      banned: true,
      banReason: 'left the company',
    })
    expect(await signInStatus(email, password)).toBe(403)
    expect((await call('GET', '/api/capabilities', cookie)).statusCode).toBe(401)

    const unban = await asAdmin('POST', `/api/instance/accounts/${id}/unban`, {})
    expect(unban.json<{ account: InstanceAdmin.Account }>().account.banned).toBe(false)
    expect(await signInStatus(email, password)).toBe(200)

    const self = await accountByEmail(admin.email)
    expect((await asAdmin('POST', `/api/instance/accounts/${self.id}/ban`, {})).statusCode).toBe(
      409,
    )
  })

  it('signs an account out everywhere', async () => {
    const email = 'twice@acme.test'
    const password = 'twice-password-long-12'
    await asAdmin('POST', '/api/instance/accounts', { email, name: 'Twice', password })
    const one = await signIn(app, email, password)
    const two = await signIn(app, email, password)
    const { id } = await accountByEmail(email)
    expect((await asAdmin('POST', `/api/instance/accounts/${id}/sign-out`, {})).statusCode).toBe(
      204,
    )
    expect((await call('GET', '/api/capabilities', one)).statusCode).toBe(401)
    expect((await call('GET', '/api/capabilities', two)).statusCode).toBe(401)
    expect((await accountByEmail(email)).lastSignInAt).toBeNull()
  })

  it('makes and removes instance admins, and keeps the last one', async () => {
    const { id } = await accountByEmail(member.email)
    const up = await asAdmin('PATCH', `/api/instance/accounts/${id}`, { instanceAdmin: true })
    expect(up.json<{ account: InstanceAdmin.Account }>().account.instanceAdmin).toBe(true)
    const down = await asAdmin('PATCH', `/api/instance/accounts/${id}`, { instanceAdmin: false })
    expect(down.json<{ account: InstanceAdmin.Account }>().account.instanceAdmin).toBe(false)

    const admins = (await asAdmin('GET', '/api/instance/accounts?pageSize=100'))
      .json<InstanceAdmin.AccountList>()
      .accounts.filter((a) => a.instanceAdmin)
    // Demote all but the signed-in one; the last cannot go.
    const others = await Promise.all(
      admins
        .filter((x) => x.email !== admin.email)
        .map((a) => asAdmin('PATCH', `/api/instance/accounts/${a.id}`, { instanceAdmin: false })),
    )
    expect(others.map((r) => r.statusCode)).toEqual(others.map(() => 200))
    const self = await accountByEmail(admin.email)
    expect(
      (await asAdmin('PATCH', `/api/instance/accounts/${self.id}`, { instanceAdmin: false }))
        .statusCode,
    ).toBe(409)
  })
})

describe('workspaces', () => {
  it('lists with counts and creates one for an existing account', async () => {
    const before = (
      await asAdmin('GET', '/api/instance/workspaces')
    ).json<InstanceAdmin.WorkspaceList>()
    expect(before.workspaces[0]).toMatchObject({ memberCount: 1, teamCount: 1, storageBytes: 0 })
    // The seeded workspace belongs to someone else: the admin may see it but is not in it.
    expect(before.workspaces[0]).toMatchObject({ youAreMember: false })
    expect(before.workspaces[0]?.ownerName).toEqual(expect.any(String))

    const res = await asAdmin('POST', '/api/instance/workspaces', {
      name: 'Globex Inc',
      ownerEmail: member.email,
    })
    expect(res.statusCode).toBe(201)
    expect(res.json<{ workspace: InstanceAdmin.Workspace }>().workspace).toMatchObject({
      name: 'Globex Inc',
      slug: 'globex-inc',
      memberCount: 1,
      teamCount: 0,
    })
    expect((await accountByEmail(member.email)).workspaceCount).toBe(1)
    expect(
      (
        await asAdmin('POST', '/api/instance/workspaces', {
          name: 'Ghost',
          ownerEmail: 'nobody@acme.test',
        })
      ).statusCode,
    ).toBe(404)
  })
})

describe('settings and mail', () => {
  it('describes the effective settings without any secret', async () => {
    const res = await asAdmin('GET', '/api/instance/settings')
    expect(res.statusCode).toBe(200)
    const s = res.json<InstanceAdmin.Settings>()
    expect(s).toMatchObject({
      publicUrl: ORIGIN,
      workspaceCreation: 'admin',
      mail: {
        configured: true,
        from: 'CirCI <ci@acme.test>',
        host: 'smtp.acme.test',
        authenticated: true,
      },
      auth: { password: true },
      githubApp: { source: 'none', appId: null },
      retention: { defaultTeamRetentionDays: 30, gcGraceHours: 24 },
    })
    expect(res.body).not.toContain('smtp-secret-do-not-leak')
    expect(res.body).not.toContain('mailer-login')
  })

  it('sends a test mail to the admin, and reports failures as text', async () => {
    sent.length = 0
    const ok = (await asAdmin('POST', '/api/instance/mail/test')).json<InstanceAdmin.MailTest>()
    expect(ok).toMatchObject({ ok: true, to: admin.email })
    expect(sent).toHaveLength(1)
    expect(sent[0]?.to).toBe(admin.email)

    mailFails = true
    try {
      const failed = await asAdmin('POST', '/api/instance/mail/test')
      expect(failed.statusCode).toBe(200)
      expect(failed.json<InstanceAdmin.MailTest>()).toMatchObject({ ok: false })
      expect(failed.json<InstanceAdmin.MailTest>().message).toContain('connection refused')
    } finally {
      mailFails = false
    }
  })
})

const shape = (f: { id: string; level: string }) => `${f.id}:${f.level}`
const checklist = async () =>
  (
    await asAdmin('GET', '/api/instance/health/address-checklist')
  ).json<InstanceAdmin.AddressChecklist>()

describe('health', () => {
  it('runs the same doctor checks as the CLI', async () => {
    const res = await asAdmin('GET', '/api/instance/health/checks')
    expect(res.statusCode).toBe(200)
    const expected = await runDoctor(
      config,
      fetchHost,
      new FsStorage({ path: dir }),
      instanceProbes({ db: t.db, config, mailer }),
    )
    const body = res.json<InstanceAdmin.Checks>()
    // Free disk space changes between two calls, so compare what each check is and finds.
    expect(body.findings.map(shape)).toEqual(expected.map(shape))
    expect(body.findings.map((f) => f.id)).toEqual(expect.arrayContaining(['database', 'mail']))
    expect(body.warned).toBe(expected.some((f) => f.level === 'warn' || f.level === 'fail'))
  })

  it('gives every finding a label, a detail and an optional mono value', async () => {
    const body = (await asAdmin('GET', '/api/instance/health/checks')).json<InstanceAdmin.Checks>()
    for (const f of body.findings) {
      expect(f.label).not.toBe('')
      expect(f.detail).not.toBe('')
      expect(f.message).toContain(f.label)
    }
    const by = Object.fromEntries(body.findings.map((f) => [f.id, f]))
    expect(by['database']).toMatchObject({
      level: 'ok',
      label: 'Database',
      detail: 'Reachable. Migrations are current.',
      value: expect.stringMatching(/^\d+ migrations?$/),
    })
    expect(by['storage']).toMatchObject({
      level: 'ok',
      label: 'Storage',
      detail: 'Reachable and writable.',
      value: config.storage.driver === 'fs' ? config.storage.path : undefined,
    })
    // The mail server accepts nothing here (the fake mailer has no `verify`): a note, with the server as value.
    expect(by['mail']).toMatchObject({ label: 'Mail', value: 'smtp.acme.test:587' })
  })

  it('lists what changes with the address, from the configuration', async () => {
    const body = (
      await asAdmin('GET', '/api/instance/health/address-checklist')
    ).json<InstanceAdmin.AddressChecklist>()
    expect(body.publicUrl).toBe(ORIGIN)
    expect(body.steps.map((s) => s.id)).toEqual(
      expect.arrayContaining(['dns', 'sessions', 'sign-in-redirects', 'git-webhooks', 'ci']),
    )
    expect(body.steps.find((s) => s.id === 'dns')?.values).toContain(`PUBLIC_URL=${ORIGIN}`)
    expect(body.steps.some((s) => s.id === 'github-app')).toBe(false)
    // No move is in progress: PREVIOUS_PUBLIC_URLS is not set.
    expect(body.previousHosts).toEqual([])
  })

  it('dismisses the move checklist for this address, and shows it again', async () => {
    expect((await checklist()).dismissed).toBe(false)
    const url = '/api/instance/health/address-checklist/dismissed'
    expect((await call('PUT', url, memberCookie)).statusCode).toBe(403)
    expect((await call('DELETE', url, memberCookie)).statusCode).toBe(403)
    expect((await checklist()).dismissed).toBe(false)
    expect((await call('PUT', url, adminCookie)).statusCode).toBe(204)
    const hidden = await checklist()
    expect(hidden.dismissed).toBe(true)
    expect(hidden.steps.length).toBeGreaterThan(0)
    expect((await call('DELETE', url, adminCookie)).statusCode).toBe(204)
    expect((await checklist()).dismissed).toBe(false)
  })

  it('counts jobs per queue', async () => {
    await enqueueJob(t.db, { queue: QUEUES.webhook, payload: { a: 1 } })
    await enqueueJob(t.db, { queue: QUEUES.webhook, payload: { a: 2 } })
    await enqueueJob(t.db, { queue: 'odd-queue', payload: {} })
    await t.db
      .update(schema.jobs)
      .set({ status: 'failed' })
      .where(eq(schema.jobs.queue, 'odd-queue'))
    const body = (await asAdmin('GET', '/api/instance/health/queues')).json<InstanceAdmin.Queues>()
    const by = Object.fromEntries(body.queues.map((q) => [q.queue, q]))
    expect(by[QUEUES.webhook]).toMatchObject({ pending: 2, running: 0, failed: 0 })
    expect(by[QUEUES.webhook]?.oldestPendingAt).toEqual(expect.any(String))
    expect(by[QUEUES.webhook]).toMatchObject({ retrying: 0, mostRetried: null })
    expect(by['odd-queue']).toMatchObject({ pending: 0, failed: 1 })
    expect(by[QUEUES.processBuild]).toMatchObject({ pending: 0, running: 0, failed: 0 })
  })

  it('counts pending jobs that failed before as retrying, with their next attempt', async () => {
    await t.db
      .update(schema.jobs)
      .set({ attempts: 2, maxAttempts: 8 })
      .where(eq(schema.jobs.queue, QUEUES.webhook))
    const body = (await asAdmin('GET', '/api/instance/health/queues')).json<InstanceAdmin.Queues>()
    const webhook = body.queues.find((q) => q.queue === QUEUES.webhook)
    expect(webhook).toMatchObject({ retrying: 2, mostRetried: { attempt: 3, maxAttempts: 8 } })
  })
})

describe('workspace membership', () => {
  it('says which workspaces the signed-in admin belongs to, with each owner', async () => {
    const res = await asAdmin('POST', '/api/instance/workspaces', {
      name: 'Admin Home',
      ownerEmail: admin.email,
    })
    expect(res.json<{ workspace: InstanceAdmin.Workspace }>().workspace).toMatchObject({
      youAreMember: true,
      ownerName: 'Root',
    })
    const list = (
      await asAdmin('GET', '/api/instance/workspaces')
    ).json<InstanceAdmin.WorkspaceList>()
    expect(list.workspaces.find((w) => w.slug === 'admin-home')?.youAreMember).toBe(true)
    expect(list.workspaces.filter((w) => w.youAreMember)).toHaveLength(1)
  })
})
