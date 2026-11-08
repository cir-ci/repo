import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { addMember, createUser } from '@circi/auth'
import type { Auth } from '@circi/auth'
import {
  getOrgSettings,
  getProjectById,
  listWebhooks,
  markInstallationNeedsAttention,
} from '@circi/db'
import { FsStorage } from '@circi/storage'
import { createTestDb, type TestDb } from '@circi/testing'
import type { FastifyInstance } from 'fastify'
import { pino } from 'pino'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { buildServer } from '../../../../src/http/app.ts'
import {
  createTestAuth,
  ORIGIN,
  seedTenant,
  signIn,
  type Tenant,
} from '../../../support/helpers.ts'

let t: TestDb
let dir: string
let app: FastifyInstance
let auth: Auth
let acme: Tenant
let rival: Tenant
let ownerCookie: string
let memberCookie: string
let rivalCookie: string

beforeAll(async () => {
  t = await createTestDb()
  auth = createTestAuth(t.db)
  dir = await mkdtemp(join(tmpdir(), 'circi-settings-'))
  app = buildServer({
    logger: pino({ level: 'silent' }),
    checks: [],
    dashboard: {
      db: t.db,
      auth,
      storage: new FsStorage({ path: join(dir, 'files') }),
      publicOrigin: ORIGIN,
      githubApp: true,
    },
  })
  await app.ready()
  acme = await seedTenant(auth, t.db)
  rival = await seedTenant(auth, t.db)
  const plain = await createUser(auth, {
    email: 'plain@acme.test',
    name: 'Plain',
    password: 'plain-password-long-1',
  })
  await addMember(auth, t.db, { orgSlug: acme.orgSlug, email: plain.email, role: 'member' })
  ownerCookie = await signIn(app, acme.owner.email, acme.owner.password)
  memberCookie = await signIn(app, plain.email, 'plain-password-long-1')
  rivalCookie = await signIn(app, rival.owner.email, rival.owner.password)
})
afterAll(async () => {
  await app.close()
  await t.close()
  await rm(dir, { recursive: true, force: true })
})

const base = () => `/api/projects/${acme.orgSlug}/web`
const call = (
  method: 'GET' | 'PATCH' | 'POST' | 'PUT' | 'DELETE',
  url: string,
  cookie: string,
  body?: unknown,
) =>
  app.inject({
    method,
    url,
    headers: {
      cookie,
      origin: ORIGIN,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { payload: JSON.stringify(body) }),
  })

describe('project settings', () => {
  it('shows settings to members, and whether they can change them', async () => {
    const owner = (await call('GET', `${base()}/settings`, ownerCookie)).json()
    expect(owner.canManage).toBe(true)
    expect(owner.settings).toMatchObject({
      defaultBranch: 'main',
      blockMergeOnChanges: true,
      diffThreshold: 0,
      retentionDays: 30,
      reviewTargetHours: 24,
    })
    const member = (await call('GET', `${base()}/settings`, memberCookie)).json()
    expect(member.canManage).toBe(false)
  })

  it('lets an owner change settings, and only the ones sent', async () => {
    const res = await call('PATCH', `${base()}/settings`, ownerCookie, {
      blockMergeOnChanges: false,
      diffThreshold: 0.01,
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().settings).toMatchObject({
      blockMergeOnChanges: false,
      diffThreshold: 0.01,
      defaultBranch: 'main',
    })
    expect((await getProjectById(t.db, acme.project.id))?.blockMergeOnChanges).toBe(false)
  })

  it('rejects invalid values and unknown fields', async () => {
    const codes = await Promise.all(
      [
        { diffThreshold: 2 },
        { retentionDays: 0 },
        { defaultBranch: '  ' },
        { ciKeyId: 'x' },
        { reviewTargetHours: 0 },
      ].map(
        async (body) => (await call('PATCH', `${base()}/settings`, ownerCookie, body)).statusCode,
      ),
    )
    expect(codes).toEqual([400, 400, 400, 400, 400])
  })

  it('sets the review target in hours, and clears it with null', async () => {
    const set = await call('PATCH', `${base()}/settings`, ownerCookie, { reviewTargetHours: 8 })
    expect(set.json().settings.reviewTargetHours).toBe(8)
    const cleared = await call('PATCH', `${base()}/settings`, ownerCookie, {
      reviewTargetHours: null,
    })
    expect(cleared.json().settings.reviewTargetHours).toBeNull()
    await call('PATCH', `${base()}/settings`, ownerCookie, { reviewTargetHours: 24 })
  })

  it('lets a project inherit the organization on flaky screenshots, or set its own', async () => {
    const got = (await call('GET', `${base()}/settings`, memberCookie)).json()
    // Nothing set: the project inherits, and the organization blocks, as before.
    expect(got.settings.flakyBlocksMerge).toBeNull()
    expect(got.org).toEqual({ flakyBlocksMerge: true })

    const off = await call('PATCH', `${base()}/settings`, ownerCookie, { flakyBlocksMerge: false })
    expect(off.json().settings.flakyBlocksMerge).toBe(false)
    expect((await getProjectById(t.db, acme.project.id))?.flakyBlocksMerge).toBe(false)

    const inherit = await call('PATCH', `${base()}/settings`, ownerCookie, {
      flakyBlocksMerge: null,
    })
    expect(inherit.json().settings.flakyBlocksMerge).toBeNull()
    expect((await getProjectById(t.db, acme.project.id))?.flakyBlocksMerge).toBeNull()

    const bad = await call('PATCH', `${base()}/settings`, ownerCookie, { flakyBlocksMerge: 'no' })
    expect(bad.statusCode).toBe(400)
  })

  it('refuses plain members with 403 and outsiders with 404', async () => {
    expect(
      (await call('PATCH', `${base()}/settings`, memberCookie, { name: 'x' })).statusCode,
    ).toBe(403)
    expect((await call('GET', `${base()}/settings`, rivalCookie)).statusCode).toBe(404)
    expect((await call('PATCH', `${base()}/settings`, rivalCookie, { name: 'x' })).statusCode).toBe(
      404,
    )
  })
})

describe('project webhooks', () => {
  it('creates a webhook and shows the secret once', async () => {
    const res = await call('POST', `${base()}/webhooks`, ownerCookie, {
      url: 'https://hooks.acme.io/circi',
      events: ['build.reviewed'],
    })
    expect(res.statusCode).toBe(201)
    const { webhook, secret } = res.json()
    expect(secret).toMatch(/^whsec_/)
    expect(webhook).toMatchObject({
      url: 'https://hooks.acme.io/circi',
      events: ['build.reviewed'],
    })
    expect(webhook.secret).toBeUndefined()

    const listed = (await call('GET', `${base()}/settings`, memberCookie)).json()
    expect(listed.webhooks).toHaveLength(1)
    expect(JSON.stringify(listed)).not.toContain('whsec_')
  })

  it('refuses addresses on private networks, bad schemes and unknown events', async () => {
    const codes = await Promise.all(
      [
        { url: 'http://169.254.169.254/latest' },
        { url: 'http://localhost:9000/x' },
        { url: 'ftp://hooks.acme.io' },
        { url: 'https://hooks.acme.io', events: ['build.exploded'] },
      ].map(
        async (body) => (await call('POST', `${base()}/webhooks`, ownerCookie, body)).statusCode,
      ),
    )
    expect(codes).toEqual([400, 400, 400, 400])
  })

  it('refuses a webhook with no events: missing or empty does not mean "all"', async () => {
    const url = 'https://hooks.acme.io/none'
    for (const body of [{ url }, { url, events: [] }]) {
      // eslint-disable-next-line no-await-in-loop -- two requests
      const res = await call('POST', `${base()}/webhooks`, ownerCookie, body)
      expect(res.statusCode).toBe(400)
      expect(res.json().error).toBe('Choose at least one event for the webhook to receive')
    }
    expect(await listWebhooks(t.db, acme.project.id)).toHaveLength(1)
  })

  it('keeps plain members and outsiders from adding or removing webhooks', async () => {
    const body = { url: 'https://hooks.acme.io/other' }
    expect((await call('POST', `${base()}/webhooks`, memberCookie, body)).statusCode).toBe(403)
    expect((await call('POST', `${base()}/webhooks`, rivalCookie, body)).statusCode).toBe(404)
    const [hook] = await listWebhooks(t.db, acme.project.id)
    expect((await call('DELETE', `${base()}/webhooks/${hook?.id}`, memberCookie)).statusCode).toBe(
      403,
    )
    expect((await call('DELETE', `${base()}/webhooks/${hook?.id}`, rivalCookie)).statusCode).toBe(
      404,
    )
  })

  it('deletes a webhook, and answers 404 for a missing or malformed id', async () => {
    const [hook] = await listWebhooks(t.db, acme.project.id)
    expect((await call('DELETE', `${base()}/webhooks/${hook?.id}`, ownerCookie)).statusCode).toBe(
      204,
    )
    expect(await listWebhooks(t.db, acme.project.id)).toHaveLength(0)
    expect((await call('DELETE', `${base()}/webhooks/${hook?.id}`, ownerCookie)).statusCode).toBe(
      404,
    )
    expect((await call('DELETE', `${base()}/webhooks/nope`, ownerCookie)).statusCode).toBe(404)
  })
})

const put = (cookie: string, payload: unknown) => call('PUT', `${base()}/github`, cookie, payload)

describe('GitHub link', () => {
  it('links a project to a repository and shows it in the settings', async () => {
    const before = (await call('GET', `${base()}/settings`, memberCookie)).json().github
    expect(before).toEqual({
      configured: true,
      webhookUrl: `${ORIGIN}/webhooks/github`,
      link: null,
    })
    const res = await put(ownerCookie, { installationId: '4242', repoRef: 'acme/web' })
    expect(res.statusCode).toBe(200)
    const after = (await call('GET', `${base()}/settings`, memberCookie)).json().github
    expect(after.link).toEqual({ installationId: '4242', repoRef: 'acme/web', attention: null })
  })

  it('rejects malformed values, and anyone who is not an owner or admin', async () => {
    const bad = await Promise.all(
      [
        { installationId: 'abc', repoRef: 'acme/web' },
        { installationId: '1', repoRef: 'not a repo' },
        { installationId: '1' },
      ].map(async (b) => (await put(ownerCookie, b)).statusCode),
    )
    expect(bad).toEqual([400, 400, 400])
    expect((await put(memberCookie, { installationId: '1', repoRef: 'a/b' })).statusCode).toBe(403)
    expect((await put(rivalCookie, { installationId: '1', repoRef: 'a/b' })).statusCode).toBe(404)
  })

  it('shows that GitHub refuses the installation, on the settings and the project page, until it is linked again', async () => {
    await put(ownerCookie, { installationId: '4243', repoRef: 'acme/web' })
    const settings = async () =>
      (await call('GET', `${base()}/settings`, memberCookie)).json().github.link.attention
    const page = async () => (await call('GET', base(), memberCookie)).json().gitAttention
    expect(await settings()).toBeNull()
    expect(await page()).toBeNull()

    await markInstallationNeedsAttention(t.db, 'github', '4243', 'installation_revoked')
    expect(await settings()).toEqual({
      reason: 'installation_revoked',
      since: expect.stringMatching(/^\d{4}-\d\d-\d\dT/),
    })
    expect(await page()).toEqual(await settings())
    // Another organization's project is not told.
    expect(
      (await call('GET', `/api/projects/${rival.orgSlug}/web`, rivalCookie)).json().gitAttention,
    ).toBeNull()

    expect(
      (await put(ownerCookie, { installationId: '4243', repoRef: 'acme/web' })).statusCode,
    ).toBe(200)
    expect(await settings()).toBeNull()
    expect(await page()).toBeNull()
  })

  it('unlinks', async () => {
    expect((await call('DELETE', `${base()}/github`, ownerCookie)).statusCode).toBe(204)
    const after = (await call('GET', `${base()}/settings`, ownerCookie)).json().github
    expect(after.link).toBeNull()
  })
})

const orgUrl = () => `/api/organizations/${acme.orgSlug}/settings`

describe('organization settings', () => {
  it('shows the defaults to members, and whether they can change them', async () => {
    const owner = (await call('GET', orgUrl(), ownerCookie)).json()
    expect(owner).toEqual({ canManage: true, settings: { flakyBlocksMerge: true } })
    expect((await call('GET', orgUrl(), memberCookie)).json().canManage).toBe(false)
  })

  it('lets an owner change them, and projects that inherit see the new value', async () => {
    const res = await call('PATCH', orgUrl(), ownerCookie, { flakyBlocksMerge: false })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ settings: { flakyBlocksMerge: false } })
    expect(await getOrgSettings(t.db, acme.project.orgId)).toEqual({ flakyBlocksMerge: false })
    const project = (await call('GET', `${base()}/settings`, memberCookie)).json()
    expect(project.org).toEqual({ flakyBlocksMerge: false })
    expect(project.settings.flakyBlocksMerge).toBeNull()
  })

  it('rejects invalid values and unknown fields', async () => {
    const codes = await Promise.all(
      [{ flakyBlocksMerge: 'yes' }, { flakyBlocksMerge: null }, { other: true }].map(
        async (body) => (await call('PATCH', orgUrl(), ownerCookie, body)).statusCode,
      ),
    )
    expect(codes).toEqual([400, 400, 400])
  })

  it('refuses plain members with 403 and outsiders with 404', async () => {
    expect(
      (await call('PATCH', orgUrl(), memberCookie, { flakyBlocksMerge: true })).statusCode,
    ).toBe(403)
    expect((await call('GET', orgUrl(), rivalCookie)).statusCode).toBe(404)
    expect(
      (await call('PATCH', orgUrl(), rivalCookie, { flakyBlocksMerge: true })).statusCode,
    ).toBe(404)
    expect(await getOrgSettings(t.db, acme.project.orgId)).toEqual({ flakyBlocksMerge: false })
  })
})
