import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { addMember, createUser } from '@circi/auth'
import { openSecret } from '@circi/core/node'
import {
  getBuildDetail,
  getWorkspaceBySlug,
  listIntegrations,
  listTeamLinks,
} from '@circi/db/queries'
import * as schema from '@circi/db/schema'
import { createTestDb, seedBuild, seedDiff, seedScreenshot } from '@circi/db/testing'
import { FsStorage } from '@circi/storage'
import { fakeSha } from '@circi/testing'
import { eq } from 'drizzle-orm'
import { pino } from 'pino'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

import { buildServer } from '#http/app.ts'
import { caller } from '#test/support/client.ts'
import { snapshotDb } from '#test/support/db-snapshot.ts'
import { createTestAuth, ORIGIN, seedTenant, signIn } from '#test/support/helpers.ts'

const SECRET = 'test-secret-that-is-long-enough-1234'
const t = await createTestDb()
const dir = await mkdtemp(join(tmpdir(), 'circi-figma-'))
const auth = createTestAuth(t.db)

/**
 * Figma's HTTP edge, behind the real Figma definition: two tokens, one file `FileKey12345` with a
 * page of two frames; 403 for a token it does not know, 404 for any other file.
 */
const users: Record<string, { id: string; handle: string }> = {
  figd_michael: { id: 'fu-1', handle: 'michael' },
  figd_other: { id: 'fu-2', handle: 'other' },
}
const frames = [
  { id: '1:1', name: 'Home', type: 'FRAME' },
  { id: '1:2', name: 'Cart', type: 'FRAME' },
]
const fake = { down: false, revoked: new Set<string>(), requests: 0 }
const fakeFetch: typeof fetch = async (input, init) => {
  const req = new Request(input, init)
  const url = new URL(req.url)
  fake.requests += 1
  if (fake.down) return new Response('boom', { status: 500 })
  const token = req.headers.get('x-figma-token') ?? ''
  const user = users[token]
  if (!user || fake.revoked.has(token)) {
    return Response.json({ status: 403, err: 'Invalid token' }, { status: 403 })
  }
  if (url.pathname === '/v1/me') return Response.json(user)
  if (!url.pathname.startsWith('/v1/files/FileKey12345')) {
    return Response.json({ err: 'Not found' }, { status: 404 })
  }
  if (url.pathname.endsWith('/nodes')) {
    const ids = (url.searchParams.get('ids') ?? '').split(',')
    return Response.json({
      nodes: Object.fromEntries(
        ids.map((id) => {
          if (id === '0:1') return [id, { document: { id, name: 'Pages', children: frames } }]
          const frame = frames.find((f) => f.id === id)
          return [id, frame ? { document: { ...frame, children: [] } } : null]
        }),
      ),
    })
  }
  return Response.json({
    name: 'Checkout v3',
    document: { id: '0:0', name: 'Document', children: [{ id: '0:1', name: 'Pages' }] },
  })
}

const app = buildServer({
  logger: pino({ level: 'silent' }),
  checks: [],
  dashboard: {
    db: t.db,
    auth,
    storage: new FsStorage({ path: dir }),
    publicOrigin: ORIGIN,
    authSecret: SECRET,
    integrations: { config: {}, fetch: fakeFetch },
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

const workspace = await getWorkspaceBySlug(t.db, acme.workspaceSlug)
const workspaceBase = `/api/workspaces/${acme.workspaceSlug}/integrations`
const FILE = 'https://www.figma.com/design/FileKey12345/Checkout?node-id=1-2'
const FRAME = (node: string) => `https://www.figma.com/design/FileKey12345/x?node-id=${node}`

const reset = await snapshotDb(t)
beforeEach(async () => {
  await reset()
  Object.assign(fake, { down: false, requests: 0 })
  fake.revoked.clear()
  id = ''
})

/** The one Figma integration of the workspace (set by `connected`). */
let id = ''
const mappingUrl = () => `${workspaceBase}/${id}/teams/web`
const storedLinks = () => listTeamLinks(t.db, acme.team.id, 'figma-frame')
const links = (path = '') => `${workspaceBase}/${id}/teams/web/links${path}`

/** Connects Figma for Acme as its owner. */
async function connected() {
  const res = await call('POST', `${workspaceBase}/figma/connect`, ownerCookie, {
    token: 'figd_michael',
  })
  expect(res.statusCode).toBe(201)
  id = res.json().id
  return res
}

/** Connected, with the `web` team mapped to the file. */
async function mapped() {
  await connected()
  expect((await call('PUT', mappingUrl(), ownerCookie, { ref: FILE })).statusCode).toBe(204)
}

const addLink = (pattern: string, frame: string) =>
  call('POST', links(), ownerCookie, { values: { pattern, url: FRAME(frame) } })

/** Mapped, with a manual link `cart*` and an automatic one for `home`, on Acme's first build. */
async function autoLinked() {
  await mapped()
  expect((await addLink('cart*', '1-2')).statusCode).toBe(201)
  const build = await seedBuild(t.db, acme.team.id)
  await seedScreenshot(t.db, { buildId: build.id, fileSha256: fakeSha('a'), name: 'home' })
  await seedScreenshot(t.db, { buildId: build.id, fileSha256: fakeSha('b'), name: 'cart' })
  await seedScreenshot(t.db, { buildId: build.id, fileSha256: fakeSha('c'), name: 'pricing' })
  await seedDiff(t.db, { buildId: build.id, name: 'home', status: 'changed' })
  await seedDiff(t.db, { buildId: build.id, name: 'cart', status: 'changed' })
  expect((await call('POST', links('/auto'), louCookie)).statusCode).toBe(403)
  const res = await call('POST', links('/auto'), ownerCookie)
  expect(res.statusCode).toBe(200)
  expect(res.json()).toEqual({ created: 1, unlinked: 1, frames: 2 })
  return build
}

describe('connecting Figma', () => {
  it('needs a session, membership, and an admin for writes', async () => {
    const body = { token: 'figd_michael' }
    expect((await call('POST', `${workspaceBase}/figma/connect`, '', body)).statusCode).toBe(401)
    expect((await call('POST', `${workspaceBase}/figma/connect`, louCookie, body)).statusCode).toBe(
      403,
    )
    expect(
      (await call('POST', `${workspaceBase}/figma/connect`, rivalCookie, body)).statusCode,
    ).toBe(404)
  })

  it('rejects a bad token and a Figma outage, storing nothing', async () => {
    const connect = `${workspaceBase}/figma/connect`
    const bad = await call('POST', connect, ownerCookie, { token: 'figd_wrongtoken' })
    expect(bad.statusCode).toBe(400)
    expect(bad.json().error).toMatch(/rejected/)
    fake.down = true
    expect((await call('POST', connect, ownerCookie, { token: 'figd_michael' })).statusCode).toBe(
      502,
    )
    fake.down = false
    expect((await call('POST', connect, ownerCookie, { token: 'x' })).statusCode).toBe(400)
    expect(await listIntegrations(t.db, workspace.id)).toEqual([])
  })

  it('connects with a verified token, stored sealed, and lists Figma in the catalog as a generic integration', async () => {
    await connected()
    const [row] = await t.db
      .select()
      .from(schema.integrations)
      .where(eq(schema.integrations.id, id))
    expect(row).toMatchObject({ kind: 'figma', displayName: 'michael', externalId: 'fu-1' })
    expect(openSecret(SECRET, row?.encryptedCredentials ?? '')).toBe('figd_michael')
    const list = await call('GET', workspaceBase, louCookie)
    expect(list.json().catalog.find((e: { kind: string }) => e.kind === 'figma')).toMatchObject({
      built: true,
      connectable: true,
      mapping: { targetLabel: 'File', targetKind: 'text' },
      links: { kind: 'figma-frame', autoLink: true, subject: 'pattern' },
    })
    expect(JSON.stringify(list.json())).not.toContain('figd_michael')
    expect(list.json().integrations).toMatchObject([{ kind: 'figma', teamCount: 0 }])
  })

  it('answers 409 for the same account again', async () => {
    await connected()
    const again = await call('POST', `${workspaceBase}/figma/connect`, ownerCookie, {
      token: 'figd_michael',
    })
    expect(again.statusCode).toBe(409)
  })
})

describe('a team’s Figma file', () => {
  it('lists every team with no file first', async () => {
    await connected()
    const page = (await call('GET', `${workspaceBase}/${id}/teams`, louCookie)).json()
    expect(page).toMatchObject({
      canManage: false,
      integration: { name: 'michael', needsAttention: false },
      teams: [{ slug: 'web', mapping: null }],
    })
  })

  it('is set by admins from an address or a key, after Figma confirms it', async () => {
    await connected()
    expect((await call('PUT', mappingUrl(), louCookie, { ref: 'FileKey12345' })).statusCode).toBe(
      403,
    )
    const missing = await call('PUT', mappingUrl(), ownerCookie, {
      ref: 'Missing12345',
    })
    expect(missing.statusCode).toBe(400)
    expect(missing.json().error).toBe('Figma could not find that file')
    const bad = await call('PUT', mappingUrl(), ownerCookie, { ref: 'not a file' })
    expect(bad.statusCode).toBe(400)
    expect(bad.json().error).toBe("That isn't a Figma file address")
    expect((await call('PUT', mappingUrl(), ownerCookie, { ref: FILE })).statusCode).toBe(204)
    const page = (await call('GET', `${workspaceBase}/${id}/teams`, louCookie)).json()
    expect(page.teams[0].mapping).toMatchObject({ ref: 'FileKey12345', name: 'Checkout v3' })
  })

  it('404s for a team that isn’t in the workspace', async () => {
    await connected()
    expect(
      (await call('PUT', `${workspaceBase}/${id}/teams/nope`, ownerCookie, { ref: 'FileKey12345' }))
        .statusCode,
    ).toBe(404)
  })

  it('flags the connection when Figma stops accepting the token', async () => {
    await mapped()
    fake.revoked.add('figd_michael')
    const res = await call('PUT', mappingUrl(), ownerCookie, { ref: FILE })
    fake.revoked.clear()
    expect(res.statusCode).toBe(409)
    expect((await listIntegrations(t.db, workspace.id))[0]).toMatchObject({
      needsAttention: true,
      needsAttentionReason: expect.stringMatching(/token was rejected/),
    })
  })
})

describe('links', () => {
  const url = links

  it('creates a manual link from a pasted frame address, naming the frame', async () => {
    await mapped()
    const body = { values: { pattern: 'cart', url: FRAME('1-2') } }
    expect((await call('POST', url(), louCookie, body)).statusCode).toBe(403)
    const noNode = await call('POST', url(), ownerCookie, {
      values: { pattern: 'cart', url: 'https://www.figma.com/design/FileKey12345/x' },
    })
    expect(noNode.statusCode).toBe(400)
    expect(
      (await call('POST', url(), ownerCookie, { values: { pattern: 'cart' } })).statusCode,
    ).toBe(400)
    expect((await call('POST', url(), ownerCookie, { nope: 1 })).statusCode).toBe(400)
    const res = await call('POST', url(), ownerCookie, {
      values: { pattern: 'cart*', url: FRAME('1-2') },
    })
    expect(res.statusCode).toBe(201)
    expect(res.json()).toMatchObject({
      subject: 'cart*',
      ref: 'FileKey12345:1:2',
      title: 'Cart',
      source: 'manual',
      url: 'https://www.figma.com/design/FileKey12345?node-id=1-2',
    })
  })

  it('replaces the link of a pattern added again', async () => {
    await mapped()
    expect((await addLink('cart*', '1-2')).statusCode).toBe(201)
    const again = await call('POST', url(), ownerCookie, {
      values: { pattern: 'cart*', url: FRAME('1-1') },
    })
    expect(again.statusCode).toBe(201)
    expect(again.json()).toMatchObject({ ref: 'FileKey12345:1:1', title: 'Home' })
    expect(await storedLinks()).toHaveLength(1)
  })

  it('links automatically by name without overwriting the manual link', async () => {
    await autoLinked()
    const listed = (await call('GET', url(), louCookie)).json().links
    expect(
      listed.map((l: { subject: string; source: string; title: string }) => [
        l.subject,
        l.source,
        l.title,
      ]),
    ).toEqual([
      ['cart*', 'manual', 'Cart'],
      ['home', 'auto', 'Home'],
    ])
  })

  it('puts the frame on the build detail’s snapshots', async () => {
    await autoLinked()
    const detail = await call('GET', `/api/teams/${acme.workspaceSlug}/web/builds/1`, louCookie)
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
    expect((await getBuildDetail(t.db, acme.team.id, 1))?.diffs[0]?.figma?.frameName).toBe('Cart')
  })

  it('links only what the signed-in workspace can see', async () => {
    await mapped()
    expect((await call('GET', url(), rivalCookie)).statusCode).toBe(404)
    expect((await call('GET', url(), '')).statusCode).toBe(401)
    expect((await call('POST', url('/auto'), rivalCookie)).statusCode).toBe(404)
  })

  it('removes a link (admins), 404 for unknown ids', async () => {
    await autoLinked()
    const [link] = await storedLinks()
    expect((await call('DELETE', url(`/${link?.id}`), louCookie)).statusCode).toBe(403)
    expect((await call('DELETE', url('/not-a-uuid'), ownerCookie)).statusCode).toBe(404)
    expect((await call('DELETE', url(`/${link?.id}`), ownerCookie)).statusCode).toBe(204)
    expect((await call('DELETE', url(`/${link?.id}`), ownerCookie)).statusCode).toBe(404)
    expect(await storedLinks()).toHaveLength(1)
  })

  it('changing the file drops automatic links and keeps manual ones; clearing it does too', async () => {
    await autoLinked()
    await call('POST', url(), ownerCookie, { values: { pattern: 'manual-one', url: FRAME('1-1') } })
    const before = (await storedLinks()).length
    expect((await storedLinks()).map((l) => l.payload.source)).toContain('auto')
    // The same file again leaves every link.
    expect((await call('PUT', mappingUrl(), ownerCookie, { ref: FILE })).statusCode).toBe(204)
    expect(await storedLinks()).toHaveLength(before)
    expect((await call('DELETE', mappingUrl(), louCookie)).statusCode).toBe(403)
    expect((await call('DELETE', mappingUrl(), ownerCookie)).statusCode).toBe(204)
    expect(
      (await storedLinks())
        .map((l) => [l.subject, l.payload.source])
        .toSorted(([x], [y]) => String(x).localeCompare(String(y))),
    ).toEqual([
      ['cart*', 'manual'],
      ['manual-one', 'manual'],
    ])
    const page = (await call('GET', `${workspaceBase}/${id}/teams`, louCookie)).json()
    expect(page.teams[0].mapping).toBeNull()
  })

  it('wants a mapped file to link automatically', async () => {
    await connected()
    const res = await call('POST', url('/auto'), ownerCookie)
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toMatch(/Choose a file/)
  })

  it('removing the integration forgets its links', async () => {
    await mapped()
    expect((await addLink('cart*', '1-2')).statusCode).toBe(201)
    expect(await storedLinks()).toHaveLength(1)
    expect((await call('DELETE', `${workspaceBase}/${id}`, ownerCookie)).statusCode).toBe(204)
    expect(await storedLinks()).toEqual([])
    expect(await listIntegrations(t.db, workspace.id)).toEqual([])
  })
})
