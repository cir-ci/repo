import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { addMember, createUser } from '@circi/auth'
import { openSecret } from '@circi/core'
import { getWorkspaceBySlug, listIntegrations, schema } from '@circi/db'
import { derivedWebhookSecret } from '@circi/integrations'
import { GitlabProvider, providerRegistry } from '@circi/providers'
import { FsStorage } from '@circi/storage'
import { createTestDb, seedGitLink } from '@circi/testing'
import { eq } from 'drizzle-orm'
import { pino } from 'pino'
import { afterAll, describe, expect, it } from 'vitest'

import { buildServer } from '#http/app.ts'
import { caller } from '#test/support/client.ts'
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
await addMember(auth, t.db, { workspaceSlug: acme.workspaceSlug, email: lou.email, role: 'member' })
const louCookie = await signIn(app, lou.email, 'lou-password-long-1')

const call = caller(() => app)

const base = `/api/workspaces/${acme.workspaceSlug}/integrations`
const workspace = await getWorkspaceBySlug(t.db, acme.workspaceSlug)
const connect = { baseUrl: 'https://gitlab.example.com/', token: 'good' }

describe('POST /api/workspaces/:workspace/integrations/gitlab/connect', () => {
  it('needs a session, a workspace you belong to, and an owner or admin', async () => {
    expect((await call('POST', `${base}/gitlab/connect`, '', connect)).statusCode).toBe(401)
    expect((await call('POST', `${base}/gitlab/connect`, rivalCookie, connect)).statusCode).toBe(
      404,
    )
    expect((await call('POST', `${base}/gitlab/connect`, louCookie, connect)).statusCode).toBe(403)
    expect(await listIntegrations(t.db, workspace.id)).toEqual([])
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
      expect((await call('POST', `${base}/gitlab/connect`, ownerCookie, body)).statusCode).toBe(400)
    }
  })

  it('stores nothing when GitLab refuses the token or is down', async () => {
    const refused = await call('POST', `${base}/gitlab/connect`, ownerCookie, {
      ...connect,
      token: 'wrong',
    })
    expect(refused.statusCode).toBe(400)
    expect(refused.body).not.toContain('wrong')
    fake.setDown(true)
    expect((await call('POST', `${base}/gitlab/connect`, ownerCookie, connect)).statusCode).toBe(
      502,
    )
    fake.setDown(false)
    expect(await listIntegrations(t.db, workspace.id)).toEqual([])
  })

  it('verifies through the provider, then stores address and token sealed under host#user', async () => {
    const res = await call('POST', `${base}/gitlab/connect`, ownerCookie, connect)
    expect(res.statusCode).toBe(201)
    const [row] = await t.db
      .select()
      .from(schema.integrations)
      .where(eq(schema.integrations.workspaceId, workspace.id))
    expect(row).toMatchObject({
      kind: 'gitlab',
      externalId: 'gitlab.example.com#7',
      displayName: 'gitlab.example.com#7',
    })
    expect(row?.encryptedCredentials).not.toContain('good')
    expect(JSON.parse(openSecret(AUTH_SECRET, row?.encryptedCredentials ?? '') ?? '{}')).toEqual({
      baseUrl: 'https://gitlab.example.com',
      token: 'good',
    })
  })

  it('connecting the same principal again keeps one connection', async () => {
    const res = await call('POST', `${base}/gitlab/connect`, ownerCookie, connect)
    expect(res.statusCode).toBe(201)
    expect(
      (await listIntegrations(t.db, workspace.id)).filter((c) => c.kind === 'gitlab'),
    ).toHaveLength(1)
  })

  it('supports several connections, and refuses a principal another workspace has', async () => {
    const second = await call('POST', `${base}/gitlab/connect`, ownerCookie, {
      baseUrl: 'https://gitlab.example.com',
      token: 'other',
    })
    expect(second.statusCode).toBe(201)
    const taken = await call(
      'POST',
      `/api/workspaces/${rival.workspaceSlug}/integrations/gitlab/connect`,
      rivalCookie,
      connect,
    )
    expect(taken.statusCode).toBe(409)
    // The same token on another instance is another principal.
    const elsewhere = await call(
      'POST',
      `/api/workspaces/${rival.workspaceSlug}/integrations/gitlab/connect`,
      rivalCookie,
      { baseUrl: 'https://git.other.example', token: 'good' },
    )
    expect(elsewhere.statusCode).toBe(201)
  })
})

const connections = async () =>
  (await t.db.select().from(schema.integrations))
    .filter((i) => i.workspaceId === workspace.id && i.kind === 'gitlab')
    .toSorted((a, b) => a.externalId.localeCompare(b.externalId))

describe('GitLab mapping page and team mapping', () => {
  it('shows members the page without the webhook secret, managers with it', async () => {
    const [first] = await connections()
    const url = `${base}/${first?.id}/teams`
    const manager = (await call('GET', url, ownerCookie)).json()
    expect(manager).toMatchObject({
      canManage: true,
      integration: { kind: 'gitlab', name: 'gitlab.example.com#7', needsAttention: false },
      definition: { mapping: { targetKind: 'repository' } },
      webhook: {
        url: `${ORIGIN}/webhooks/gitlab`,
        secret: derivedWebhookSecret(AUTH_SECRET, 'gitlab'),
      },
      teams: [{ slug: 'web', mapping: null }],
    })
    const member = (await call('GET', url, louCookie)).json()
    expect(member).toMatchObject({ canManage: false, webhook: { secret: null } })
    expect(JSON.stringify(member)).not.toContain('good')
    expect((await call('GET', url, rivalCookie)).statusCode).toBe(404)
    expect((await call('GET', url, '')).statusCode).toBe(401)
  })

  it('lists teams through the connection own token', async () => {
    const [first] = await connections()
    const res = await call('GET', `${base}/${first?.id}/targets`, ownerCookie)
    expect(res.json()).toEqual({
      targets: [
        { id: 'acme/web', name: 'acme/web' },
        { id: 'acme/tools/oss', name: 'acme/tools/oss' },
      ],
    })
  })

  it('maps a team to a GitLab project with a namespace path, and unmaps it', async () => {
    const [first] = await connections()
    const url = `${base}/${first?.id}/teams/web`
    const body = { ref: 'acme/tools/oss' }
    expect((await call('PUT', url, louCookie, body)).statusCode).toBe(403)
    expect((await call('PUT', url, rivalCookie, body)).statusCode).toBe(404)
    expect((await call('PUT', url, ownerCookie, { ref: 'nonsense' })).statusCode).toBe(400)
    expect(
      (await call('PUT', `${base}/${crypto.randomUUID()}/teams/web`, ownerCookie, body)).statusCode,
    ).toBe(404)
    expect(
      (await call('PUT', `${base}/${first?.id}/teams/nope`, ownerCookie, body)).statusCode,
    ).toBe(404)
    expect((await call('PUT', url, ownerCookie, body)).statusCode).toBe(204)
    const page = (await call('GET', `${base}/${first?.id}/teams`, ownerCookie)).json()
    expect(page.teams).toMatchObject([
      { slug: 'web', mapping: { ref: 'acme/tools/oss', name: 'acme/tools/oss' } },
    ])
    expect((await call('DELETE', url, louCookie)).statusCode).toBe(403)
    expect((await call('DELETE', url, ownerCookie)).statusCode).toBe(204)
    expect(
      (await call('GET', `${base}/${first?.id}/teams`, ownerCookie)).json().teams[0].mapping,
    ).toBeNull()
  })

  it('moves a team from one GitLab connection to the other instead of keeping both', async () => {
    const [first, second] = await connections()
    const body = { ref: 'acme/web' }
    expect(
      (await call('PUT', `${base}/${first?.id}/teams/web`, ownerCookie, body)).statusCode,
    ).toBe(204)
    expect(
      (await call('PUT', `${base}/${second?.id}/teams/web`, ownerCookie, body)).statusCode,
    ).toBe(204)
    const mapped = async (id: string | undefined) =>
      (await call('GET', `${base}/${id}/teams`, ownerCookie)).json().teams[0].mapping
    expect(await mapped(first?.id)).toBeNull()
    expect(await mapped(second?.id)).toMatchObject({ ref: 'acme/web' })
  })

  it('moves a team from a GitHub installation to GitLab: one git host per team', async () => {
    const github = await seedGitLink(t.db, acme.team.id, {
      externalId: '4242',
      repoRef: 'acme/web',
    })
    const [first] = await connections()
    expect(
      (await call('PUT', `${base}/${first?.id}/teams/web`, ownerCookie, { ref: 'acme/web' }))
        .statusCode,
    ).toBe(204)
    const [row] = await t.db
      .select()
      .from(schema.integrationTeams)
      .where(eq(schema.integrationTeams.integrationId, github.integrationId))
    expect(row).toBeUndefined()
  })

  it('marks GitLab built and connectable in the catalog', async () => {
    const catalog = (await call('GET', base, ownerCookie)).json().catalog
    expect(catalog.find((e: { kind: string }) => e.kind === 'gitlab')).toMatchObject({
      built: true,
      connectable: true,
    })
  })
})
