import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { addMember, createUser } from '@circi/auth'
import { openSecret } from '@circi/core'
import { getWorkspaceBySlug, listIntegrations, schema } from '@circi/db'
import { derivedWebhookSecret } from '@circi/integrations'
import { ProviderApiError, providerRegistry } from '@circi/providers'
import { FsStorage } from '@circi/storage'
import { createTestDb } from '@circi/testing'
import { eq } from 'drizzle-orm'
import { pino } from 'pino'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

import { buildServer } from '#http/app.ts'
import { caller } from '#test/support/client.ts'
import { snapshotDb } from '#test/support/db-snapshot.ts'
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
await addMember(auth, t.db, { workspaceSlug: acme.workspaceSlug, email: lou.email, role: 'member' })
const louCookie = await signIn(app, lou.email, 'lou-password-long-1')

const call = caller(() => app)

const base = `/api/workspaces/${acme.workspaceSlug}/integrations`
const workspace = await getWorkspaceBySlug(t.db, acme.workspaceSlug)

const reset = await snapshotDb(t)
beforeEach(reset)

/** Connects Acme to the `acme-ws` Bitbucket workspace as its owner. */
async function connectAcme(
  body: Record<string, unknown> = { bitbucketWorkspace: 'acme-ws', token: 'good' },
) {
  const res = await call('POST', `${base}/bitbucket/connect`, ownerCookie, body)
  expect(res.statusCode).toBe(201)
}

describe('POST /api/workspaces/:workspace/integrations/bitbucket/connect', () => {
  const connect = { bitbucketWorkspace: 'Acme-WS', token: 'good' }

  it('needs a session, a workspace you belong to, and an owner or admin', async () => {
    expect((await call('POST', `${base}/bitbucket/connect`, '', connect)).statusCode).toBe(401)
    expect((await call('POST', `${base}/bitbucket/connect`, rivalCookie, connect)).statusCode).toBe(
      404,
    )
    expect((await call('POST', `${base}/bitbucket/connect`, louCookie, connect)).statusCode).toBe(
      403,
    )
    expect(await listIntegrations(t.db, workspace.id)).toEqual([])
  })

  it('validates the body', async () => {
    for (const body of [
      {},
      { bitbucketWorkspace: 'acme' },
      { bitbucketWorkspace: 'has space', token: 'x' },
      { bitbucketWorkspace: 'acme', token: '' },
      { bitbucketWorkspace: 'acme', token: 'x', extra: 1 },
    ]) {
      // eslint-disable-next-line no-await-in-loop -- in order
      expect((await call('POST', `${base}/bitbucket/connect`, ownerCookie, body)).statusCode).toBe(
        400,
      )
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
      const res = await call('POST', `${base}/bitbucket/connect`, ownerCookie, connect)
      expect(res.statusCode).toBe(status)
      expect(res.body).not.toContain('good')
    }
    failure = undefined
    expect(await listIntegrations(t.db, workspace.id)).toEqual([])
  })

  it('verifies through the provider, then stores the token sealed under the workspace slug', async () => {
    listed.length = 0
    const res = await call('POST', `${base}/bitbucket/connect`, ownerCookie, connect)
    expect(res.statusCode).toBe(201)
    expect(listed).toHaveLength(1)
    expect(listed[0]?.workspace).toBe('acme-ws')
    expect(JSON.parse(listed[0]?.credentials ?? '{}')).toEqual({ token: 'good' })
    const [row] = await t.db
      .select()
      .from(schema.integrations)
      .where(eq(schema.integrations.workspaceId, workspace.id))
    expect(row).toMatchObject({ kind: 'bitbucket', externalId: 'acme-ws' })
    expect(row?.encryptedCredentials).not.toContain('good')
    expect(openSecret(AUTH_SECRET, row?.encryptedCredentials ?? '')).toBe('{"token":"good"}')
  })

  it('connecting again replaces the token without a second connection', async () => {
    await connectAcme()
    const res = await call('POST', `${base}/bitbucket/connect`, ownerCookie, {
      bitbucketWorkspace: 'acme-ws',
      token: 'newer',
      username: 'ann',
    })
    expect(res.statusCode).toBe(201)
    const rows = await t.db
      .select()
      .from(schema.integrations)
      .where(eq(schema.integrations.workspaceId, workspace.id))
    expect(rows).toHaveLength(1)
    expect(
      JSON.parse(openSecret(AUTH_SECRET, rows[0]?.encryptedCredentials ?? '') ?? '{}'),
    ).toEqual({ token: 'newer', username: 'ann' })
  })

  it('refuses a workspace another workspace already connected', async () => {
    await connectAcme()
    const res = await call(
      'POST',
      `/api/workspaces/${rival.workspaceSlug}/integrations/bitbucket/connect`,
      rivalCookie,
      {
        bitbucketWorkspace: 'acme-ws',
        token: 'good',
      },
    )
    expect(res.statusCode).toBe(409)
  })
})

const connection = async () =>
  (await t.db.select().from(schema.integrations)).find(
    (i) => i.workspaceId === workspace.id && i.kind === 'bitbucket',
  )

describe('Bitbucket mapping page and team mapping', () => {
  beforeEach(() => connectAcme({ bitbucketWorkspace: 'acme-ws', token: 'newer', username: 'ann' }))

  it('shows members the page without the webhook secret, and managers with it', async () => {
    const id = (await connection())?.id
    const url = `${base}/${id}/teams`
    const manager = (await call('GET', url, ownerCookie)).json()
    expect(manager).toMatchObject({
      canManage: true,
      integration: { kind: 'bitbucket', name: 'acme-ws', needsAttention: false },
      webhook: {
        url: `${ORIGIN}/webhooks/bitbucket`,
        secret: derivedWebhookSecret(AUTH_SECRET, 'bitbucket'),
      },
      teams: [{ slug: 'web', mapping: null }],
    })
    const member = (await call('GET', url, louCookie)).json()
    expect(member).toMatchObject({ canManage: false, webhook: { secret: null } })
    expect(JSON.stringify(member)).not.toContain('newer')
    expect((await call('GET', url, rivalCookie)).statusCode).toBe(404)
    expect((await call('GET', url, '')).statusCode).toBe(401)
  })

  it('lists the repositories a connection can see, through its own token', async () => {
    const id = (await connection())?.id
    listed.length = 0
    const res = await call('GET', `${base}/${id}/targets`, ownerCookie)
    expect(res.json()).toEqual({ targets: [{ id: 'acme-ws/web', name: 'acme-ws/web' }] })
    expect(JSON.parse(listed[0]?.credentials ?? '{}')).toEqual({ token: 'newer', username: 'ann' })
  })

  it('maps a team to a repository, and unmaps it', async () => {
    const id = (await connection())?.id
    const url = `${base}/${id}/teams/web`
    const body = { ref: 'acme-ws/web' }
    expect((await call('PUT', url, louCookie, body)).statusCode).toBe(403)
    expect((await call('PUT', url, rivalCookie, body)).statusCode).toBe(404)
    expect((await call('PUT', url, ownerCookie, { ref: 'nonsense' })).statusCode).toBe(400)
    expect(
      (await call('PUT', `${base}/${crypto.randomUUID()}/teams/web`, ownerCookie, body)).statusCode,
    ).toBe(404)
    expect((await call('PUT', `${base}/${id}/teams/nope`, ownerCookie, body)).statusCode).toBe(404)
    expect((await call('PUT', url, ownerCookie, body)).statusCode).toBe(204)
    expect((await call('GET', `${base}/${id}/teams`, ownerCookie)).json().teams).toMatchObject([
      { slug: 'web', mapping: { ref: 'acme-ws/web' } },
    ])
    expect((await call('DELETE', url, louCookie)).statusCode).toBe(403)
    expect((await call('DELETE', url, ownerCookie)).statusCode).toBe(204)
    expect(
      (await call('GET', `${base}/${id}/teams`, ownerCookie)).json().teams[0].mapping,
    ).toBeNull()
  })

  it('marks Bitbucket built and connectable in the catalog', async () => {
    const catalog = (await call('GET', base, ownerCookie)).json().catalog
    expect(catalog.find((e: { kind: string }) => e.kind === 'bitbucket')).toMatchObject({
      built: true,
      connectable: true,
    })
  })
})
