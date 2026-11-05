import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { addMember, createUser } from '@circi/auth'
import type { Auth } from '@circi/auth'
import { getProjectById, listWebhooks } from '@circi/db'
import { FsStorage } from '@circi/storage'
import type { FastifyInstance } from 'fastify'
import { pino } from 'pino'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createTestDb, type TestDb } from '../../../../packages/db/test/helpers.ts'
import { buildServer } from '../../src/http/app.ts'
import { createTestAuth, ORIGIN, seedTenant, signIn, type Tenant } from '../helpers.ts'

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
      [{ diffThreshold: 2 }, { retentionDays: 0 }, { defaultBranch: '  ' }, { ciKeyId: 'x' }].map(
        async (body) => (await call('PATCH', `${base()}/settings`, ownerCookie, body)).statusCode,
      ),
    )
    expect(codes).toEqual([400, 400, 400, 400])
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
    expect(after.link).toEqual({ installationId: '4242', repoRef: 'acme/web' })
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

  it('unlinks', async () => {
    expect((await call('DELETE', `${base()}/github`, ownerCookie)).statusCode).toBe(204)
    const after = (await call('GET', `${base()}/settings`, ownerCookie)).json().github
    expect(after.link).toBeNull()
  })
})
