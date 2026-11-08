import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { addMember, createUser } from '@circi/auth'
import { openSecret } from '@circi/core'
import { getOrganizationBySlug, listGitConnections, schema } from '@circi/db'
import { ProviderApiError, providerRegistry } from '@circi/providers'
import { FsStorage } from '@circi/storage'
import { createTestDb } from '@circi/testing'
import { eq } from 'drizzle-orm'
import { pino } from 'pino'
import { afterAll, describe, expect, it } from 'vitest'

import { buildServer } from '#http/app.ts'
import { bitbucketWebhookSecret } from '#http/lib/bitbucket-secret.ts'
import { createTestAuth, ORIGIN, seedTenant, signIn } from '#test/support/helpers.ts'

const AUTH_SECRET = 'instance-secret-long-enough-for-test'
const t = await createTestDb()
const dir = await mkdtemp(join(tmpdir(), 'circi-bitbucket-'))
const auth = createTestAuth(t.db)
const listed: { workspace: string; credentials: string | undefined }[] = []
let failure: ProviderApiError | Error | undefined
const app = buildServer({
  logger: pino({ level: 'silent' }),
  checks: [],
  dashboard: {
    db: t.db,
    auth,
    storage: new FsStorage({ path: dir }),
    publicOrigin: ORIGIN,
    authSecret: AUTH_SECRET,
    providers: providerRegistry({
      bitbucket: {
        // The fake Bitbucket edge: the token `good` works for any workspace.
        async listRepositories(workspace: string, credentials?: string) {
          listed.push({ workspace, credentials })
          if (failure) throw failure
          return [{ ref: `${workspace}/web`, private: true }]
        },
      },
    }),
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

describe('POST /api/orgs/:org/integrations/bitbucket', () => {
  const connect = { workspace: 'Acme-WS', token: 'good' }

  it('needs a session, an organization you belong to, and an owner or admin', async () => {
    expect((await call('POST', `${base}/bitbucket`, '', connect)).statusCode).toBe(401)
    expect((await call('POST', `${base}/bitbucket`, rivalCookie, connect)).statusCode).toBe(404)
    expect((await call('POST', `${base}/bitbucket`, louCookie, connect)).statusCode).toBe(403)
    expect(await listGitConnections(t.db, org.id)).toEqual([])
  })

  it('validates the body', async () => {
    for (const body of [
      {},
      { workspace: 'acme' },
      { workspace: 'has space', token: 'x' },
      { workspace: 'acme', token: '' },
      { workspace: 'acme', token: 'x', extra: 1 },
    ]) {
      // eslint-disable-next-line no-await-in-loop -- in order
      expect((await call('POST', `${base}/bitbucket`, ownerCookie, body)).statusCode).toBe(400)
    }
  })

  it('stores nothing when Bitbucket refuses the token, cannot find the workspace, or is down', async () => {
    const cases: [ProviderApiError | Error, number][] = [
      [new ProviderApiError(401, 'bad', { revoked: true }), 400],
      [new ProviderApiError(404, 'no workspace'), 400],
      [new ProviderApiError(403, 'scope'), 400],
      [new ProviderApiError(500, 'down'), 502],
      [new Error('timeout'), 502],
    ]
    for (const [err, status] of cases) {
      failure = err
      // eslint-disable-next-line no-await-in-loop -- in order
      const res = await call('POST', `${base}/bitbucket`, ownerCookie, connect)
      expect(res.statusCode).toBe(status)
      expect(res.body).not.toContain('good')
    }
    failure = undefined
    expect(await listGitConnections(t.db, org.id)).toEqual([])
  })

  it('verifies through the provider, then stores the token sealed under the workspace slug', async () => {
    listed.length = 0
    const res = await call('POST', `${base}/bitbucket`, ownerCookie, connect)
    expect(res.statusCode).toBe(201)
    expect(listed).toHaveLength(1)
    expect(listed[0]?.workspace).toBe('acme-ws')
    expect(JSON.parse(listed[0]?.credentials ?? '{}')).toEqual({ token: 'good' })
    const [row] = await t.db
      .select()
      .from(schema.providerConnections)
      .where(eq(schema.providerConnections.orgId, org.id))
    expect(row).toMatchObject({ kind: 'bitbucket', externalId: 'acme-ws' })
    expect(row?.encryptedCredentials).not.toContain('good')
    expect(openSecret(AUTH_SECRET, row?.encryptedCredentials ?? '')).toBe('{"token":"good"}')
  })

  it('connecting again replaces the token without a second connection', async () => {
    const res = await call('POST', `${base}/bitbucket`, ownerCookie, {
      workspace: 'acme-ws',
      token: 'newer',
      username: 'ann',
    })
    expect(res.statusCode).toBe(201)
    const rows = await t.db
      .select()
      .from(schema.providerConnections)
      .where(eq(schema.providerConnections.orgId, org.id))
    expect(rows).toHaveLength(1)
    expect(
      JSON.parse(openSecret(AUTH_SECRET, rows[0]?.encryptedCredentials ?? '') ?? '{}'),
    ).toEqual({ token: 'newer', username: 'ann' })
  })

  it('refuses a workspace another organization already connected', async () => {
    const res = await call(
      'POST',
      `/api/orgs/${rival.orgSlug}/integrations/bitbucket`,
      rivalCookie,
      {
        workspace: 'acme-ws',
        token: 'good',
      },
    )
    expect(res.statusCode).toBe(409)
  })
})

describe('Bitbucket page and project mapping', () => {
  it('shows members the page without the webhook secret, and managers with it', async () => {
    const manager = (await call('GET', `${base}/bitbucket`, ownerCookie)).json()
    expect(manager).toMatchObject({
      canManage: true,
      webhookUrl: `${ORIGIN}/webhooks/bitbucket`,
      webhookSecret: bitbucketWebhookSecret(AUTH_SECRET),
      connections: [{ workspace: 'acme-ws', needsAttention: false }],
      projects: [{ slug: 'web', repoRef: null, connectionId: null }],
    })
    const member = (await call('GET', `${base}/bitbucket`, louCookie)).json()
    expect(member).toMatchObject({ canManage: false, webhookSecret: null })
    expect(JSON.stringify(member)).not.toContain('newer')
    expect((await call('GET', `${base}/bitbucket`, rivalCookie)).statusCode).toBe(404)
    expect((await call('GET', `${base}/bitbucket`, '')).statusCode).toBe(401)
  })

  it('lists the repositories a connection can see, through its own token', async () => {
    const page = (await call('GET', `${base}/bitbucket`, ownerCookie)).json()
    listed.length = 0
    const res = await call('GET', `${base}/${page.connections[0].id}/repositories`, ownerCookie)
    expect(res.json()).toEqual({ repositories: [{ ref: 'acme-ws/web', private: true }] })
    expect(JSON.parse(listed[0]?.credentials ?? '{}')).toEqual({ token: 'newer', username: 'ann' })
  })

  it('links a project to a repository, and unlinks it', async () => {
    const page = (await call('GET', `${base}/bitbucket`, ownerCookie)).json()
    const connectionId: string = page.connections[0].id
    const url = `${base}/bitbucket/projects/web`
    expect(
      (await call('PUT', url, louCookie, { connectionId, repoRef: 'acme-ws/web' })).statusCode,
    ).toBe(403)
    expect(
      (await call('PUT', url, rivalCookie, { connectionId, repoRef: 'acme-ws/web' })).statusCode,
    ).toBe(404)
    expect(
      (await call('PUT', url, ownerCookie, { connectionId, repoRef: 'nonsense' })).statusCode,
    ).toBe(400)
    expect(
      (
        await call('PUT', url, ownerCookie, {
          connectionId: crypto.randomUUID(),
          repoRef: 'acme-ws/web',
        })
      ).statusCode,
    ).toBe(404)
    expect(
      (
        await call('PUT', `${base}/bitbucket/projects/nope`, ownerCookie, {
          connectionId,
          repoRef: 'acme-ws/web',
        })
      ).statusCode,
    ).toBe(404)
    expect(
      (await call('PUT', url, ownerCookie, { connectionId, repoRef: 'acme-ws/web' })).statusCode,
    ).toBe(200)
    expect((await call('GET', `${base}/bitbucket`, ownerCookie)).json().projects).toEqual([
      { slug: 'web', name: 'web', repoRef: 'acme-ws/web', connectionId },
    ])
    expect((await call('DELETE', url, louCookie)).statusCode).toBe(403)
    expect((await call('DELETE', url, ownerCookie)).statusCode).toBe(204)
    expect((await call('GET', `${base}/bitbucket`, ownerCookie)).json().projects[0]).toMatchObject({
      repoRef: null,
      connectionId: null,
    })
    expect((await call('DELETE', url, ownerCookie)).statusCode).toBe(404)
  })

  it('marks Bitbucket built and connectable in the catalog', async () => {
    const catalog = (await call('GET', base, ownerCookie)).json().catalog
    expect(catalog.find((e: { kind: string }) => e.kind === 'bitbucket')).toMatchObject({
      built: true,
      connectable: true,
    })
  })
})
