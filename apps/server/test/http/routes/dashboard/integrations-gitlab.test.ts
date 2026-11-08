import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { addMember, createUser } from '@circi/auth'
import { openSecret } from '@circi/core'
import { getOrganizationBySlug, listGitConnections, schema } from '@circi/db'
import { GitlabProvider, providerRegistry } from '@circi/providers'
import { FsStorage } from '@circi/storage'
import { createTestDb } from '@circi/testing'
import { eq } from 'drizzle-orm'
import { pino } from 'pino'
import { afterAll, describe, expect, it } from 'vitest'

import { buildServer } from '#http/app.ts'
import { gitlabWebhookSecret } from '#http/lib/gitlab-secret.ts'
import { fakeGitlab } from '#test/support/fake-gitlab.ts'
import { createTestAuth, ORIGIN, seedTenant, signIn } from '#test/support/helpers.ts'

const AUTH_SECRET = 'instance-secret-long-enough-for-test'
const t = await createTestDb()
const dir = await mkdtemp(join(tmpdir(), 'circi-gitlab-'))
const auth = createTestAuth(t.db)
const fake = fakeGitlab()
const gitlab = new GitlabProvider({ fetch: fake.fetcher })
const app = buildServer({
  logger: pino({ level: 'silent' }),
  checks: [],
  dashboard: {
    db: t.db,
    auth,
    storage: new FsStorage({ path: dir }),
    publicOrigin: ORIGIN,
    authSecret: AUTH_SECRET,
    gitlab,
    providers: providerRegistry({ gitlab }),
  },
})
await app.ready()
afterAll(async () => {
  await app.close()
  await t.close()
  await rm(dir, { recursive: true, force: true })
})

const acme = await seedTenant(auth, t.db)
const rival = await seedTenant(auth, t.db)
const ownerCookie = await signIn(app, acme.owner.email, acme.owner.password)
const rivalCookie = await signIn(app, rival.owner.email, rival.owner.password)
const lou = await createUser(auth, {
  email: 'lou@acme.test',
  name: 'Lou',
  password: 'lou-password-long-1',
})
await addMember(auth, t.db, { orgSlug: acme.orgSlug, email: lou.email, role: 'member' })
const louCookie = await signIn(app, lou.email, 'lou-password-long-1')

const call = (
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  url: string,
  cookie: string,
  payload?: unknown,
) =>
  app.inject({
    method,
    url,
    headers: {
      ...(payload === undefined ? {} : { 'content-type': 'application/json' }),
      ...(cookie ? { cookie } : {}),
      origin: ORIGIN,
    },
    ...(payload === undefined ? {} : { payload: JSON.stringify(payload) }),
  })

const base = `/api/orgs/${acme.orgSlug}/integrations`
const org = await getOrganizationBySlug(t.db, acme.orgSlug)
const connect = { baseUrl: 'https://gitlab.example.com/', token: 'good' }

describe('POST /api/orgs/:org/integrations/gitlab', () => {
  it('needs a session, an organization you belong to, and an owner or admin', async () => {
    expect((await call('POST', `${base}/gitlab`, '', connect)).statusCode).toBe(401)
    expect((await call('POST', `${base}/gitlab`, rivalCookie, connect)).statusCode).toBe(404)
    expect((await call('POST', `${base}/gitlab`, louCookie, connect)).statusCode).toBe(403)
    expect(await listGitConnections(t.db, org.id)).toEqual([])
  })

  it('validates the body and the address', async () => {
    for (const body of [
      {},
      { baseUrl: 'https://gitlab.example.com' },
      { baseUrl: 'nope', token: 'x' },
      { baseUrl: 'ftp://gitlab.example.com', token: 'x' },
      { baseUrl: 'https://gitlab.example.com', token: '' },
      { baseUrl: 'https://gitlab.example.com', token: 'x', extra: 1 },
      // Private addresses are refused unless the instance allows them (like webhooks).
      { baseUrl: 'http://10.0.0.5', token: 'good' },
      { baseUrl: 'http://localhost:8080', token: 'good' },
    ]) {
      // eslint-disable-next-line no-await-in-loop -- in order
      expect((await call('POST', `${base}/gitlab`, ownerCookie, body)).statusCode).toBe(400)
    }
  })

  it('stores nothing when GitLab refuses the token or is down', async () => {
    const refused = await call('POST', `${base}/gitlab`, ownerCookie, {
      ...connect,
      token: 'wrong',
    })
    expect(refused.statusCode).toBe(400)
    expect(refused.body).not.toContain('wrong')
    fake.setDown(true)
    expect((await call('POST', `${base}/gitlab`, ownerCookie, connect)).statusCode).toBe(502)
    fake.setDown(false)
    expect(await listGitConnections(t.db, org.id)).toEqual([])
  })

  it('verifies through the provider, then stores address and token sealed under host#user', async () => {
    const res = await call('POST', `${base}/gitlab`, ownerCookie, connect)
    expect(res.statusCode).toBe(201)
    const [row] = await t.db
      .select()
      .from(schema.providerConnections)
      .where(eq(schema.providerConnections.orgId, org.id))
    expect(row).toMatchObject({ kind: 'gitlab', externalId: 'gitlab.example.com#7' })
    expect(row?.encryptedCredentials).not.toContain('good')
    expect(JSON.parse(openSecret(AUTH_SECRET, row?.encryptedCredentials ?? '') ?? '{}')).toEqual({
      baseUrl: 'https://gitlab.example.com',
      token: 'good',
    })
  })

  it('connecting the same principal again keeps one connection', async () => {
    const res = await call('POST', `${base}/gitlab`, ownerCookie, connect)
    expect(res.statusCode).toBe(201)
    expect(
      (await listGitConnections(t.db, org.id)).filter((c) => c.kind === 'gitlab'),
    ).toHaveLength(1)
  })

  it('supports several connections, and refuses a principal another organization has', async () => {
    const second = await call('POST', `${base}/gitlab`, ownerCookie, {
      baseUrl: 'https://gitlab.example.com',
      token: 'other',
    })
    expect(second.statusCode).toBe(201)
    const taken = await call(
      'POST',
      `/api/orgs/${rival.orgSlug}/integrations/gitlab`,
      rivalCookie,
      connect,
    )
    expect(taken.statusCode).toBe(409)
    // The same token on another instance is another principal.
    const elsewhere = await call(
      'POST',
      `/api/orgs/${rival.orgSlug}/integrations/gitlab`,
      rivalCookie,
      { baseUrl: 'https://git.other.example', token: 'good' },
    )
    expect(elsewhere.statusCode).toBe(201)
  })
})

describe('GitLab page and project mapping', () => {
  it('shows members the page without the webhook secret, managers with it', async () => {
    const manager = (await call('GET', `${base}/gitlab`, ownerCookie)).json()
    expect(manager).toMatchObject({
      canManage: true,
      webhookUrl: `${ORIGIN}/webhooks/gitlab`,
      webhookSecret: gitlabWebhookSecret(AUTH_SECRET),
      connections: [
        { name: 'gitlab.example.com#7', needsAttention: false },
        { name: 'gitlab.example.com#8', needsAttention: false },
      ],
      projects: [{ slug: 'web', repoRef: null, connectionId: null }],
    })
    const member = (await call('GET', `${base}/gitlab`, louCookie)).json()
    expect(member).toMatchObject({ canManage: false, webhookSecret: null })
    expect(JSON.stringify(member)).not.toContain('good')
    expect((await call('GET', `${base}/gitlab`, rivalCookie)).statusCode).toBe(404)
    expect((await call('GET', `${base}/gitlab`, '')).statusCode).toBe(401)
  })

  it('lists projects through the connection own token', async () => {
    const page = (await call('GET', `${base}/gitlab`, ownerCookie)).json()
    const res = await call('GET', `${base}/${page.connections[0].id}/repositories`, ownerCookie)
    expect(res.json()).toEqual({
      repositories: [
        { ref: 'acme/web', private: true },
        { ref: 'acme/tools/oss', private: false },
      ],
    })
  })

  it('links a project to a GitLab project with a namespace path, and unlinks it', async () => {
    const page = (await call('GET', `${base}/gitlab`, ownerCookie)).json()
    const connectionId: string = page.connections[0].id
    const url = `${base}/gitlab/projects/web`
    const body = { connectionId, repoRef: 'acme/tools/oss' }
    expect((await call('PUT', url, louCookie, body)).statusCode).toBe(403)
    expect((await call('PUT', url, rivalCookie, body)).statusCode).toBe(404)
    expect(
      (await call('PUT', url, ownerCookie, { connectionId, repoRef: 'nonsense' })).statusCode,
    ).toBe(400)
    expect(
      (await call('PUT', url, ownerCookie, { ...body, connectionId: crypto.randomUUID() }))
        .statusCode,
    ).toBe(404)
    expect((await call('PUT', `${base}/gitlab/projects/nope`, ownerCookie, body)).statusCode).toBe(
      404,
    )
    expect((await call('PUT', url, ownerCookie, body)).statusCode).toBe(200)
    expect((await call('GET', `${base}/gitlab`, ownerCookie)).json().projects).toEqual([
      { slug: 'web', name: 'web', repoRef: 'acme/tools/oss', connectionId },
    ])
    expect((await call('DELETE', url, louCookie)).statusCode).toBe(403)
    expect((await call('DELETE', url, ownerCookie)).statusCode).toBe(204)
    expect((await call('GET', `${base}/gitlab`, ownerCookie)).json().projects[0]).toMatchObject({
      repoRef: null,
      connectionId: null,
    })
    expect((await call('DELETE', url, ownerCookie)).statusCode).toBe(204)
    expect((await call('DELETE', `${base}/gitlab/projects/nope`, ownerCookie)).statusCode).toBe(404)
  })

  it('does not link a project through a GitHub connection', async () => {
    const [github] = await t.db
      .insert(schema.providerConnections)
      .values({ orgId: org.id, kind: 'github', externalId: '4242' })
      .returning()
    const res = await call('PUT', `${base}/gitlab/projects/web`, ownerCookie, {
      connectionId: github?.id,
      repoRef: 'acme/web',
    })
    expect(res.statusCode).toBe(404)
  })

  it('marks GitLab built and connectable in the catalog', async () => {
    const catalog = (await call('GET', base, ownerCookie)).json().catalog
    expect(catalog.find((e: { kind: string }) => e.kind === 'gitlab')).toMatchObject({
      built: true,
      connectable: true,
    })
  })
})
