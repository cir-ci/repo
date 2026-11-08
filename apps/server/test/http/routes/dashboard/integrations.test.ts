import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { addMember, createUser } from '@circi/auth'
import {
  connectGithub,
  createIntegration,
  getOrganizationBySlug,
  getProjectLink,
  linkProjectToGithub,
  listIntegrations,
} from '@circi/db'
import { providerRegistry } from '@circi/providers'
import { FsStorage } from '@circi/storage'
import { createTestDb } from '@circi/testing'
import { pino } from 'pino'
import { afterAll, describe, expect, it } from 'vitest'

import { buildServer } from '../../../../src/http/app.ts'
import { createTestAuth, ORIGIN, seedTenant, signIn } from '../../../support/helpers.ts'

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
    providers: providerRegistry({
      github: {
        async listRepositories(externalId: string) {
          if (failListing) throw new Error('boom')
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
await addMember(auth, t.db, { orgSlug: acme.orgSlug, email: lou.email, role: 'member' })
const louCookie = await signIn(app, lou.email, 'lou-password-long-1')

const call = (method: 'GET' | 'POST' | 'DELETE', url: string, cookie: string, payload?: unknown) =>
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

describe('GET /api/orgs/:org/integrations', () => {
  it('needs a session, and an organization you belong to', async () => {
    expect((await call('GET', base, '')).statusCode).toBe(401)
    expect((await call('GET', base, rivalCookie)).statusCode).toBe(404)
    expect((await call('GET', '/api/orgs/nope/integrations', ownerCookie)).statusCode).toBe(404)
  })

  it('lists what was added, git hosts and others together, with the whole catalog', async () => {
    await connectGithub(t.db, org.id, '501')
    await createIntegration(t.db, {
      orgId: org.id,
      kind: 'slack',
      displayName: 'Acme Slack',
      externalId: 'T1',
      encryptedCredentials: 'sealed-secret',
    })
    await createIntegration(t.db, {
      orgId: (await getOrganizationBySlug(t.db, rival.orgSlug)).id,
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
      expect(body.integrations[0]).toMatchObject({ needsAttention: false, projectCount: 0 })
      expect(JSON.stringify(body)).not.toContain('sealed-secret')
      const byKind = Object.fromEntries(body.catalog.map((e: { kind: string }) => [e.kind, e]))
      expect(byKind.github).toMatchObject({ status: 'available', connectable: true })
      expect(byKind.slack).toMatchObject({ status: 'available', connectable: false })
      expect(byKind['azure-devops']).toMatchObject({ status: 'planned', connectable: false })
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

  it('removes a non-git integration, and 404s for unknown ids', async () => {
    const slack = (await listIntegrations(t.db, org.id))[0]
    expect((await call('DELETE', `${base}/${slack?.id}`, ownerCookie)).statusCode).toBe(204)
    expect(await listIntegrations(t.db, org.id)).toEqual([])
    expect((await call('DELETE', `${base}/${slack?.id}`, ownerCookie)).statusCode).toBe(404)
    expect(
      (await call('DELETE', `${base}/00000000-0000-4000-8000-000000000000`, ownerCookie))
        .statusCode,
    ).toBe(404)
    expect((await call('DELETE', `${base}/not-a-uuid`, ownerCookie)).statusCode).toBe(400)
  })

  it('disconnects a git host the way unlinking does: its projects stop reporting', async () => {
    await linkProjectToGithub(t.db, acme.project.id, { installationId: '501', repoRef: 'acme/web' })
    const [github] = (await call('GET', base, ownerCookie)).json().integrations
    expect(github).toMatchObject({ kind: 'github', projectCount: 1 })
    expect((await call('DELETE', `${base}/${github.id}`, ownerCookie)).statusCode).toBe(204)
    expect(await getProjectLink(t.db, acme.project.id)).toBeUndefined()
    expect((await call('GET', base, ownerCookie)).json().integrations).toEqual([])
  })
})

describe('the GitHub integration', () => {
  it('connects an installation (admins only), then lists it with each project’s repository', async () => {
    expect(
      (await call('POST', `${base}/github`, louCookie, { installationId: '7' })).statusCode,
    ).toBe(403)
    expect(
      (await call('POST', `${base}/github`, ownerCookie, { installationId: 'x' })).statusCode,
    ).toBe(400)
    const res = await call('POST', `${base}/github`, ownerCookie, { installationId: '7' })
    expect(res.statusCode).toBe(201)
    await linkProjectToGithub(t.db, acme.project.id, { installationId: '7', repoRef: 'acme/web' })

    const page = (await call('GET', `${base}/github`, louCookie)).json()
    expect(page).toMatchObject({
      canManage: false,
      configured: true,
      webhookUrl: `${ORIGIN}/webhooks/github`,
      connections: [{ id: res.json().id, installationId: '7', needsAttention: false }],
      projects: [{ slug: 'web', repoRef: 'acme/web', installationId: '7' }],
    })
    expect((await call('GET', `${base}/github`, rivalCookie)).statusCode).toBe(404)
  })

  it('lists the repositories a connection can see, for admins', async () => {
    const id = (await call('GET', `${base}/github`, ownerCookie)).json().connections[0].id
    const url = `${base}/${id}/repositories`
    expect((await call('GET', url, ownerCookie)).json()).toEqual({
      repositories: [{ ref: 'acme/web-7', private: true }],
    })
    expect((await call('GET', url, louCookie)).statusCode).toBe(403)
    expect((await call('GET', url, rivalCookie)).statusCode).toBe(404)
    failListing = true
    expect((await call('GET', url, ownerCookie)).statusCode).toBe(502)
    failListing = false
  })
})
