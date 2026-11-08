import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { addMember, createUser } from '@circi/auth'
import {
  createFigmaLink,
  findFigmaIntegration,
  getBuildDetail,
  getOrganizationBySlug,
  listFigmaLinks,
} from '@circi/db'
import { FigmaApiError } from '@circi/providers'
import { FsStorage } from '@circi/storage'
import { createTestDb, seedBuild, seedDiff, seedScreenshot, sha } from '@circi/testing'
import { pino } from 'pino'
import { afterAll, describe, expect, it } from 'vitest'

import { buildServer } from '#http/app.ts'
import { createTestAuth, ORIGIN, seedTenant, signIn } from '#test/support/helpers.ts'

const t = await createTestDb()
const dir = await mkdtemp(join(tmpdir(), 'circi-figma-'))
const auth = createTestAuth(t.db)

/** A fake of Figma at the client's edge: two tokens, one file. */
const users: Record<string, { id: string; handle: string }> = {
  figd_michael: { id: 'fu-1', handle: 'michael' },
  figd_other: { id: 'fu-2', handle: 'other' },
}
const frames = [
  { id: '1:1', name: 'Home', page: 'Pages' },
  { id: '1:2', name: 'Cart', page: 'Pages' },
]
let down = false
const figma = {
  async me(token: string) {
    if (down) throw new FigmaApiError(500, 'boom')
    const u = users[token]
    if (!u) throw new FigmaApiError(403, 'Invalid token', { revoked: true })
    return { ...u, email: null }
  },
  async getFile(token: string, key: string) {
    if (!users[token]) throw new FigmaApiError(403, 'Invalid token', { revoked: true })
    if (key !== 'FileKey12345') throw new FigmaApiError(404, 'Not found')
    return { name: 'Checkout v3', pages: [{ id: '0:1', name: 'Pages' }] }
  },
  async listFrames(token: string, key: string) {
    if (!users[token] || key !== 'FileKey12345') throw new FigmaApiError(404, 'Not found')
    return frames
  },
  async getNodeNames(_token: string, _key: string, ids: string[]) {
    return Object.fromEntries(frames.filter((f) => ids.includes(f.id)).map((f) => [f.id, f.name]))
  },
}

const app = buildServer({
  logger: pino({ level: 'silent' }),
  checks: [],
  dashboard: {
    db: t.db,
    auth,
    storage: new FsStorage({ path: dir }),
    publicOrigin: ORIGIN,
    figma,
    authSecret: 'test-secret-that-is-long-enough-1234',
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

const base = `/api/orgs/${acme.orgSlug}/integrations/figma`
const project = `${base}/projects/web`
const org = await getOrganizationBySlug(t.db, acme.orgSlug)

describe('connecting Figma', () => {
  it('needs a session, membership, and an admin for writes', async () => {
    expect((await call('GET', base, '')).statusCode).toBe(401)
    expect((await call('GET', base, rivalCookie)).statusCode).toBe(404)
    expect((await call('POST', base, louCookie, { token: 'figd_michael' })).statusCode).toBe(403)
    expect((await call('POST', base, rivalCookie, { token: 'figd_michael' })).statusCode).toBe(404)
  })

  it('shows an unconnected page to members', async () => {
    const res = await call('GET', base, louCookie)
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({
      canManage: false,
      configured: true,
      account: null,
      projects: [],
    })
  })

  it('rejects a bad token and a Figma outage, storing nothing', async () => {
    const bad = await call('POST', base, ownerCookie, { token: 'figd_wrongtoken' })
    expect(bad.statusCode).toBe(400)
    expect(bad.json().error).toMatch(/rejected/)
    down = true
    expect((await call('POST', base, ownerCookie, { token: 'figd_michael' })).statusCode).toBe(502)
    down = false
    expect((await call('POST', base, ownerCookie, { token: 'x' })).statusCode).toBe(400)
    expect(await findFigmaIntegration(t.db, org.id)).toBeUndefined()
  })

  it('connects with a verified token, stored sealed and listed in the catalog as built', async () => {
    const res = await call('POST', base, ownerCookie, { token: 'figd_michael' })
    expect(res.statusCode).toBe(201)
    const row = await findFigmaIntegration(t.db, org.id)
    expect(row).toMatchObject({ kind: 'figma', displayName: 'michael', externalId: 'fu-1' })
    expect(row?.encryptedCredentials).toBeTruthy()
    expect(row?.encryptedCredentials).not.toContain('figd_michael')
    const list = await call('GET', `/api/orgs/${acme.orgSlug}/integrations`, louCookie)
    const entry = list.json().catalog.find((e: { kind: string }) => e.kind === 'figma')
    expect(entry).toMatchObject({ built: true, connectable: true })
    expect(JSON.stringify(list.json())).not.toContain('figd_michael')
  })

  it('refuses a second connection, and the same account in another organisation (409)', async () => {
    expect((await call('POST', base, ownerCookie, { token: 'figd_other' })).statusCode).toBe(409)
    const rivalBase = `/api/orgs/${rival.orgSlug}/integrations/figma`
    const taken = await call('POST', rivalBase, rivalCookie, { token: 'figd_michael' })
    expect(taken.statusCode).toBe(409)
    expect(taken.json().error).toMatch(/another organization/)
    expect((await call('POST', rivalBase, rivalCookie, { token: 'figd_other' })).statusCode).toBe(
      201,
    )
  })
})

describe('a project’s Figma file', () => {
  it('lists projects with no file first', async () => {
    const body = (await call('GET', base, louCookie)).json()
    expect(body.account).toMatchObject({ name: 'michael', needsAttention: false })
    expect(body.projects).toEqual([
      {
        slug: 'web',
        name: 'web',
        fileKey: null,
        fileName: null,
        fileUrl: null,
        frameCount: null,
        linked: 0,
      },
    ])
  })

  it('is set by admins from an address or a key, after Figma confirms it', async () => {
    expect((await call('PUT', project, louCookie, { file: 'FileKey12345' })).statusCode).toBe(403)
    const missing = await call('PUT', project, ownerCookie, { file: 'Missing12345' })
    expect(missing.statusCode).toBe(400)
    expect((await call('PUT', project, ownerCookie, { file: 'not a file' })).statusCode).toBe(400)
    const res = await call('PUT', project, ownerCookie, {
      file: 'https://www.figma.com/design/FileKey12345/Checkout?node-id=1-2',
    })
    expect(res.statusCode).toBe(200)
    const body = (await call('GET', base, louCookie)).json()
    expect(body.projects[0]).toMatchObject({
      fileKey: 'FileKey12345',
      fileName: 'Checkout v3',
      fileUrl: 'https://www.figma.com/design/FileKey12345',
    })
  })

  it('404s for a project that isn’t in the organisation', async () => {
    expect(
      (await call('PUT', `${base}/projects/nope`, ownerCookie, { file: 'FileKey12345' }))
        .statusCode,
    ).toBe(404)
  })
})

describe('links', () => {
  it('creates a manual link from a pasted frame address, naming the frame', async () => {
    expect(
      (
        await call('POST', `${project}/links`, louCookie, {
          pattern: 'cart',
          url: 'https://www.figma.com/design/FileKey12345/x?node-id=1-2',
        })
      ).statusCode,
    ).toBe(403)
    const noNode = await call('POST', `${project}/links`, ownerCookie, {
      pattern: 'cart',
      url: 'https://www.figma.com/design/FileKey12345/x',
    })
    expect(noNode.statusCode).toBe(400)
    const res = await call('POST', `${project}/links`, ownerCookie, {
      pattern: 'cart*',
      url: 'https://www.figma.com/design/FileKey12345/x?node-id=1-2',
    })
    expect(res.statusCode).toBe(201)
    expect(res.json()).toMatchObject({
      snapshotPattern: 'cart*',
      nodeId: '1:2',
      frameName: 'Cart',
      source: 'manual',
      url: 'https://www.figma.com/design/FileKey12345?node-id=1-2',
    })
    const dup = await call('POST', `${project}/links`, ownerCookie, {
      pattern: 'cart*',
      url: 'https://www.figma.com/design/FileKey12345/x?node-id=1-1',
    })
    expect(dup.statusCode).toBe(409)
  })

  it('links automatically by name without overwriting the manual link', async () => {
    const build = await seedBuild(t.db, acme.project.id)
    await seedScreenshot(t.db, { buildId: build.id, fileSha256: sha('a'), name: 'home' })
    await seedScreenshot(t.db, { buildId: build.id, fileSha256: sha('b'), name: 'cart' })
    await seedScreenshot(t.db, { buildId: build.id, fileSha256: sha('c'), name: 'pricing' })
    await seedDiff(t.db, { buildId: build.id, name: 'home', status: 'changed' })
    await seedDiff(t.db, { buildId: build.id, name: 'cart', status: 'changed' })
    expect((await call('POST', `${project}/auto-link`, louCookie)).statusCode).toBe(403)
    const res = await call('POST', `${project}/auto-link`, ownerCookie)
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ created: 1, unlinked: 1, frames: 2 })
    const links = (await call('GET', `${project}/links`, louCookie)).json().links
    expect(
      links.map((l: { snapshotPattern: string; source: string; frameName: string }) => [
        l.snapshotPattern,
        l.source,
        l.frameName,
      ]),
    ).toEqual([
      ['cart*', 'manual', 'Cart'],
      ['home', 'auto', 'Home'],
    ])
    const page = (await call('GET', base, louCookie)).json()
    expect(page.projects[0]).toMatchObject({ linked: 2, frameCount: 2 })
  })

  it('puts the frame on the build detail’s snapshots', async () => {
    const detail = await call('GET', `/api/projects/${acme.orgSlug}/web/builds/1`, louCookie)
    expect(detail.statusCode).toBe(200)
    expect(
      detail
        .json()
        .diffs.map((d: { name: string; figma: { nodeId: string } | null }) => [
          d.name,
          d.figma?.nodeId ?? null,
        ]),
    ).toEqual([
      ['cart', '1:2'],
      ['home', '1:1'],
    ])
    expect((await getBuildDetail(t.db, acme.project.id, 1))?.diffs[0]?.figma?.frameName).toBe(
      'Cart',
    )
  })

  it('removes a link (admins), 404 for another project’s or unknown ids', async () => {
    const [link] = await listFigmaLinks(t.db, acme.project.id)
    expect((await call('DELETE', `${project}/links/${link?.id}`, louCookie)).statusCode).toBe(403)
    expect((await call('DELETE', `${project}/links/not-a-uuid`, ownerCookie)).statusCode).toBe(404)
    expect((await call('DELETE', `${project}/links/${link?.id}`, ownerCookie)).statusCode).toBe(204)
    expect((await call('DELETE', `${project}/links/${link?.id}`, ownerCookie)).statusCode).toBe(404)
    expect(await listFigmaLinks(t.db, acme.project.id)).toHaveLength(1)
  })

  it('clears the file and its automatic links, keeping manual ones', async () => {
    const integration = await findFigmaIntegration(t.db, org.id)
    await createFigmaLink(t.db, {
      integrationId: integration?.id ?? '',
      projectId: acme.project.id,
      snapshotPattern: 'manual-one',
      fileKey: 'FileKey12345',
      nodeId: '1:1',
      source: 'manual',
    })
    expect((await call('DELETE', project, louCookie)).statusCode).toBe(403)
    expect((await call('DELETE', project, ownerCookie)).statusCode).toBe(204)
    const body = (await call('GET', base, louCookie)).json()
    expect(body.projects[0]).toMatchObject({ fileKey: null, linked: 1 })
    expect((await listFigmaLinks(t.db, acme.project.id)).map((l) => l.source)).toEqual(['manual'])
  })

  it('removing the integration forgets its links', async () => {
    const [item] = (await call('GET', `/api/orgs/${acme.orgSlug}/integrations`, ownerCookie)).json()
      .integrations
    expect(
      (
        await call(
          'DELETE',
          `/api/orgs/${acme.orgSlug}/integrations/integration/${item.id}`,
          ownerCookie,
        )
      ).statusCode,
    ).toBe(204)
    expect(await listFigmaLinks(t.db, acme.project.id)).toEqual([])
    expect((await call('GET', base, ownerCookie)).json().account).toBeNull()
  })
})
