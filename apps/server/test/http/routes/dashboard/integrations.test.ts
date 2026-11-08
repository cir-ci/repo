import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { addMember, createUser } from '@circi/auth'
import {
  createIntegration,
  getWorkspaceBySlug,
  getTeamLink,
  listIntegrations,
  schema,
} from '@circi/db'
import { ProviderApiError, providerRegistry } from '@circi/providers'
import { linkTeamToGithub } from '@circi/services'
import { FsStorage } from '@circi/storage'
import { createTestDb, seedGitConnection } from '@circi/testing'
import { pino } from 'pino'
import { afterAll, describe, expect, it } from 'vitest'

import { buildServer } from '#http/app.ts'
import { createTestAuth, ORIGIN, seedTenant, signIn } from '#test/support/helpers.ts'

const t = await createTestDb()
const dir = await mkdtemp(join(tmpdir(), 'circi-integrations-'))
const auth = createTestAuth(t.db)
let failListing = false
const app = buildServer({
  logger: pino({ level: 'silent' }),
  checks: [],
  dashboard: {
    db: t.db,
    auth,
    storage: new FsStorage({ path: dir }),
    publicOrigin: ORIGIN,
    githubApp: true,
    authSecret: 'instance-secret-long-enough-for-test',
    providers: providerRegistry({
      github: {
        async listRepositories(externalId: string) {
          if (failListing) throw new Error('boom')
          // The fake GitHub edge: only installations 501, 7 and 8 exist.
          if (!['501', '7', '8'].includes(externalId) && !externalId.startsWith('55')) {
            throw new ProviderApiError(404, 'Not Found', { revoked: true })
          }
          return [{ ref: `acme/web-${externalId}`, private: true }]
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

const base = `/api/workspaces/${acme.workspaceSlug}/integrations`
const workspace = await getWorkspaceBySlug(t.db, acme.workspaceSlug)

describe('GET /api/workspaces/:workspace/integrations', () => {
  it('needs a session, and a workspace you belong to', async () => {
    expect((await call('GET', base, '')).statusCode).toBe(401)
    expect((await call('GET', base, rivalCookie)).statusCode).toBe(404)
    expect((await call('GET', '/api/workspaces/nope/integrations', ownerCookie)).statusCode).toBe(
      404,
    )
  })

  it('lists what was added, git hosts and others together, with the whole catalog', async () => {
    await seedGitConnection(t.db, { workspaceId: workspace.id, externalId: '501' })
    await createIntegration(t.db, {
      workspaceId: workspace.id,
      kind: 'slack',
      displayName: 'Acme Slack',
      externalId: 'T1',
      encryptedCredentials: 'sealed-secret',
    })
    await createIntegration(t.db, {
      workspaceId: (await getWorkspaceBySlug(t.db, rival.workspaceSlug)).id,
      kind: 'figma',
      displayName: 'Rival Figma',
      externalId: 'F1',
    })
    for (const cookie of [ownerCookie, louCookie]) {
      // eslint-disable-next-line no-await-in-loop -- two viewers, in order
      const res = await call('GET', base, cookie)
      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(body.canManage).toBe(cookie === ownerCookie)
      expect(
        body.integrations.map((i: { kind: string; group: string; name: string }) => [
          i.kind,
          i.group,
          i.name,
        ]),
      ).toEqual([
        ['github', 'git', 'Installation 501'],
        ['slack', 'chat', 'Acme Slack'],
      ])
      expect(body.integrations[0]).toMatchObject({ needsAttention: false, teamCount: 0 })
      expect(JSON.stringify(body)).not.toContain('sealed-secret')
      const byKind = Object.fromEntries(body.catalog.map((e: { kind: string }) => [e.kind, e]))
      expect(byKind.github).toMatchObject({
        status: 'available',
        built: true,
        connectable: true,
      })
      // Built, but this server has no Slack app configured.
      expect(byKind.slack).toMatchObject({
        status: 'available',
        built: true,
        connectable: false,
      })
      expect(byKind['azure-devops']).toMatchObject({
        status: 'planned',
        built: false,
        connectable: false,
      })
      expect(byKind.teams.status).toBe('planned')
      expect(byKind.penpot.status).toBe('planned')
    }
  })
})

describe('removing an integration', () => {
  it('is for admins; members get 403 and strangers 404', async () => {
    const [github] = (await call('GET', base, ownerCookie)).json().integrations
    expect((await call('DELETE', `${base}/${github.id}`, louCookie)).statusCode).toBe(403)
    expect((await call('DELETE', `${base}/${github.id}`, rivalCookie)).statusCode).toBe(404)
    expect((await call('DELETE', `${base}/${github.id}`, '')).statusCode).toBe(401)
  })

  it('removes a chat integration, and 404s for unknown ids', async () => {
    const slack = (await listIntegrations(t.db, workspace.id)).find((i) => i.kind === 'slack')
    expect((await call('DELETE', `${base}/${slack?.id}`, ownerCookie)).statusCode).toBe(204)
    expect((await listIntegrations(t.db, workspace.id)).map((i) => i.kind)).toEqual(['github'])
    expect((await call('DELETE', `${base}/${slack?.id}`, ownerCookie)).statusCode).toBe(404)
    expect(
      (await call('DELETE', `${base}/00000000-0000-4000-8000-000000000000`, ownerCookie))
        .statusCode,
    ).toBe(404)
    expect((await call('DELETE', `${base}/not-a-uuid`, ownerCookie)).statusCode).toBe(400)
  })

  it('disconnects a git host the way unlinking does: its teams stop reporting', async () => {
    await linkTeamToGithub(t.db, acme.team.id, { installationId: '501', repoRef: 'acme/web' })
    const [github] = (await call('GET', base, ownerCookie)).json().integrations
    expect(github).toMatchObject({ kind: 'github', teamCount: 1 })
    expect((await call('DELETE', `${base}/${github.id}`, ownerCookie)).statusCode).toBe(204)
    expect(await getTeamLink(t.db, acme.team.id, ['github'])).toBeUndefined()
    expect((await call('GET', base, ownerCookie)).json().integrations).toEqual([])
  })
})

const connect = (cookie: string, installationId: string) =>
  call('POST', `${base}/github/connect`, cookie, { installationId })

describe('the GitHub integration', () => {
  it('connects an installation (admins only), then maps each team to a repository', async () => {
    expect((await connect(louCookie, '7')).statusCode).toBe(403)
    expect((await connect(ownerCookie, 'x')).statusCode).toBe(400)
    const res = await connect(ownerCookie, '7')
    expect(res.statusCode).toBe(201)
    const { id } = res.json()
    // Connecting the same installation again is how someone reinstalls the App: no conflict.
    expect((await connect(ownerCookie, '7')).json().id).toBe(id)

    const put = (slug: string, ref: string) =>
      call('PUT', `${base}/${id}/teams/${slug}`, ownerCookie, { ref })
    expect((await put('web', 'not a repo')).statusCode).toBe(400)
    expect((await put('web', 'acme/web')).statusCode).toBe(204)

    const page = (await call('GET', `${base}/${id}/teams`, louCookie)).json()
    expect(page).toMatchObject({
      canManage: false,
      integration: { id, kind: 'github', name: 'Installation 7', needsAttention: false },
      definition: { mapping: { targetKind: 'repository', targetLabel: 'Repository' } },
      // The App's webhook secret is configured on GitHub: there is none to show.
      webhook: { url: `${ORIGIN}/webhooks/github`, secret: null },
      teams: [{ slug: 'web', mapping: { ref: 'acme/web', name: 'acme/web' } }],
    })
    expect((await call('GET', `${base}/${id}/teams`, rivalCookie)).statusCode).toBe(404)
    expect(await getTeamLink(t.db, acme.team.id, ['github'])).toEqual({
      installationId: '7',
      repoRef: 'acme/web',
    })
  })

  it('rejects an installation GitHub does not know, storing nothing', async () => {
    const before = (await listIntegrations(t.db, workspace.id)).length
    const res = await connect(ownerCookie, '123456')
    expect(res.statusCode).toBe(404)
    expect(res.json().error).toMatch(/not installed/)
    failListing = true
    expect((await connect(ownerCookie, '8')).statusCode).toBe(502)
    failListing = false
    expect(await listIntegrations(t.db, workspace.id)).toHaveLength(before)
  })

  it('rejects an installation another workspace already uses', async () => {
    await seedGitConnection(t.db, {
      workspaceId: (await getWorkspaceBySlug(t.db, rival.workspaceSlug)).id,
      externalId: '8',
    })
    const res = await connect(ownerCookie, '8')
    expect(res.statusCode).toBe(409)
    expect(res.json().error).toMatch(/another workspace/)
  })

  it('moves a team to the repository of another installation instead of keeping both', async () => {
    const other = (await connect(ownerCookie, '501')).json().id
    const first = (await t.db.select().from(schema.integrations)).find(
      (i) => i.workspaceId === workspace.id && i.externalId === '7',
    )
    const second = (
      await call('PUT', `${base}/${other}/teams/web`, ownerCookie, {
        ref: 'acme/api',
      })
    ).statusCode
    expect(second).toBe(204)
    expect(await getTeamLink(t.db, acme.team.id, ['github'])).toEqual({
      installationId: '501',
      repoRef: 'acme/api',
    })
    expect(first).toBeDefined()
    const page = (await call('GET', `${base}/${first?.id}/teams`, ownerCookie)).json()
    expect(page.teams[0].mapping).toBeNull()
  })

  it('lists the repositories an installation can see, for admins', async () => {
    const id = (await t.db.select().from(schema.integrations)).find(
      (i) => i.workspaceId === workspace.id && i.externalId === '7',
    )?.id
    const url = `${base}/${id}/targets`
    expect((await call('GET', url, ownerCookie)).json()).toEqual({
      targets: [{ id: 'acme/web-7', name: 'acme/web-7' }],
    })
    expect((await call('GET', url, louCookie)).statusCode).toBe(403)
    expect((await call('GET', url, rivalCookie)).statusCode).toBe(404)
    failListing = true
    expect((await call('GET', url, ownerCookie)).statusCode).toBe(502)
    failListing = false
  })
})
