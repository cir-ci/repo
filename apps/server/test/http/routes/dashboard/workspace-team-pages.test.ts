import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { addMember, createUser, verifyTeamToken } from '@circi/auth'
import type { Auth } from '@circi/auth'
import { teamColorFor } from '@circi/core'
import { schema } from '@circi/db'
import { FsStorage } from '@circi/storage'
import { createTestDb, seedBuild, seedScreenshot, seedSite, sha } from '@circi/testing'
import { eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { pino } from 'pino'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { buildServer } from '#http/app.ts'
import { createTestAuth, ORIGIN, seedTenant, signIn, type Tenant } from '#test/support/helpers.ts'

/** The team and workspace pages' endpoints: appearance, CI token, rename, storage, ignore regions. */

let t: createTestDb.Result
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
  dir = await mkdtemp(join(tmpdir(), 'circi-pages-'))
  app = buildServer({
    logger: pino({ level: 'silent' }),
    checks: [],
    dashboard: {
      db: t.db,
      auth,
      storage: new FsStorage({ path: join(dir, 'files') }),
      publicOrigin: ORIGIN,
    },
  })
  await app.ready()
  acme = await seedTenant(auth, t.db)
  rival = await seedTenant(auth, t.db)
  const plain = await createUser(auth, {
    email: 'plain@pages.test',
    name: 'Plain',
    password: 'plain-password-long-1',
  })
  await addMember(auth, t.db, {
    workspaceSlug: acme.workspaceSlug,
    email: plain.email,
    role: 'member',
  })
  ownerCookie = await signIn(app, acme.owner.email, acme.owner.password)
  memberCookie = await signIn(app, plain.email, 'plain-password-long-1')
  rivalCookie = await signIn(app, rival.owner.email, rival.owner.password)
})
afterAll(async () => {
  await app.close()
  await t.close()
  await rm(dir, { recursive: true, force: true })
})

const team = () => `/api/teams/${acme.workspaceSlug}/web`
const workspace = () => `/api/workspaces/${acme.workspaceSlug}`
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

describe('team colour and icon', () => {
  it('starts from a colour derived from the name, and shows it everywhere a team is listed', async () => {
    const settings = (await call('GET', `${team()}/settings`, memberCookie)).json()
    expect(settings.appearance).toEqual({ color: teamColorFor('web'), icon: null })
    const list = (await call('GET', '/api/teams', ownerCookie)).json()
    expect(list.teams[0].team).toMatchObject({ color: teamColorFor('web'), icon: null })
    const detail = (await call('GET', team(), ownerCookie)).json()
    expect(detail.team).toMatchObject({ color: teamColorFor('web'), icon: null })
  })

  it('lets owners change colour and icon, and shows the change in the sidebar', async () => {
    const res = await call('PATCH', `${team()}/appearance`, ownerCookie, {
      color: 'plum',
      icon: 'rocket',
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ appearance: { color: 'plum', icon: 'rocket' } })
    const bar = (await call('GET', `${workspace()}/sidebar`, memberCookie)).json()
    expect(bar.teams[0]).toMatchObject({ slug: 'web', color: 'plum', icon: 'rocket' })
    const cleared = await call('PATCH', `${team()}/appearance`, ownerCookie, { icon: null })
    expect(cleared.json()).toEqual({ appearance: { color: 'plum', icon: null } })
  })

  it('refuses a colour or icon outside the lists, unknown fields, members (403) and outsiders (404)', async () => {
    for (const body of [{ color: 'red' }, { icon: 'trash' }, { size: 3 }]) {
      // eslint-disable-next-line no-await-in-loop
      expect((await call('PATCH', `${team()}/appearance`, ownerCookie, body)).statusCode).toBe(400)
    }
    expect(
      (await call('PATCH', `${team()}/appearance`, memberCookie, { color: 'moss' })).statusCode,
    ).toBe(403)
    expect(
      (await call('PATCH', `${team()}/appearance`, rivalCookie, { color: 'moss' })).statusCode,
    ).toBe(404)
    const after = (await call('GET', `${team()}/settings`, ownerCookie)).json()
    expect(after.appearance.color).toBe('plum')
  })

  it('creates a team with a chosen colour and icon, or the derived colour', async () => {
    const chosen = await call('POST', `${workspace()}/teams`, ownerCookie, {
      name: 'Docs site',
      color: 'moss',
      icon: 'book-open',
    })
    expect(chosen.statusCode).toBe(201)
    expect(chosen.json().team).toMatchObject({
      slug: 'docs-site',
      color: 'moss',
      icon: 'book-open',
    })
    const derived = await call('POST', `${workspace()}/teams`, ownerCookie, { name: 'Marketing' })
    expect(derived.json().team).toMatchObject({ color: teamColorFor('Marketing'), icon: null })
    const bad = await call('POST', `${workspace()}/teams`, ownerCookie, { name: 'Bad', icon: 'x' })
    expect(bad.statusCode).toBe(400)
  })
})

describe('CI token page', () => {
  it('shows facts to members, rotates for owners and shows the token only in the rotate response', async () => {
    const before = (await call('GET', `${team()}/token`, memberCookie)).json()
    expect(before).toMatchObject({ canManage: false, createdBy: null, lastUsedAt: null })
    expect(before.createdAt).toEqual(expect.any(String))

    const rotated = await call('POST', `${team()}/token`, ownerCookie)
    expect(rotated.statusCode).toBe(200)
    const { token, info } = rotated.json()
    expect(token).toMatch(/^circi_/)
    expect(info).toMatchObject({
      canManage: true,
      hint: `${token.slice(0, 12)}…`,
      createdBy: { id: acme.owner.id, name: expect.any(String) },
      lastUsedAt: null,
    })

    // Later reads never carry the token, and the database holds only its hash.
    const again = await call('GET', `${team()}/token`, ownerCookie)
    expect(again.body).not.toContain(token)
    expect(Object.keys(again.json()).toSorted()).toEqual(
      ['canManage', 'createdAt', 'createdBy', 'hint', 'lastUsedAt'].toSorted(),
    )
    const keys = await t.db.select().from(schema.apikey)
    expect(JSON.stringify(keys)).not.toContain(token)

    // The old token is dead, the new one works and then shows as used.
    expect(await verifyTeamToken(auth, t.db, acme.token)).toBeUndefined()
    expect(await verifyTeamToken(auth, t.db, token)).toBeDefined()
    const used = (await call('GET', `${team()}/token`, ownerCookie)).json()
    expect(used.lastUsedAt).toEqual(expect.any(String))
  })

  it('refuses members on rotate (403) and outsiders everywhere (404)', async () => {
    expect((await call('POST', `${team()}/token`, memberCookie)).statusCode).toBe(403)
    expect((await call('POST', `${team()}/token`, rivalCookie)).statusCode).toBe(404)
    expect((await call('GET', `${team()}/token`, rivalCookie)).statusCode).toBe(404)
  })
})

describe('workspace name, address and default retention', () => {
  it('shows the name and address to members and lets owners rename', async () => {
    const got = (await call('GET', workspace(), memberCookie)).json()
    expect(got).toEqual({ canManage: false, name: expect.any(String), slug: acme.workspaceSlug })
    const res = await call('PATCH', workspace(), ownerCookie, { name: 'Acme Inc' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ name: 'Acme Inc', slug: acme.workspaceSlug })
    expect((await call('GET', workspace(), ownerCookie)).json().name).toBe('Acme Inc')
  })

  it('refuses members (403), outsiders (404), bad and taken addresses, then moves the address', async () => {
    expect((await call('PATCH', workspace(), memberCookie, { name: 'x' })).statusCode).toBe(403)
    expect((await call('PATCH', workspace(), rivalCookie, { name: 'x' })).statusCode).toBe(404)
    expect((await call('GET', workspace(), rivalCookie)).statusCode).toBe(404)
    expect((await call('PATCH', workspace(), ownerCookie, { name: '' })).statusCode).toBe(400)
    expect((await call('PATCH', workspace(), ownerCookie, { slug: 'api' })).statusCode).toBe(400)
    expect((await call('PATCH', workspace(), ownerCookie, { slug: 'No Good' })).statusCode).toBe(
      400,
    )
    expect((await call('PATCH', workspace(), ownerCookie, { bogus: 1 })).statusCode).toBe(400)
    const taken = await call('PATCH', workspace(), ownerCookie, { slug: rival.workspaceSlug })
    expect(taken.statusCode).toBe(409)

    const oldBase = workspace()
    const moved = await call('PATCH', oldBase, ownerCookie, { slug: `${acme.workspaceSlug}-two` })
    expect(moved.json().slug).toBe(`${acme.workspaceSlug}-two`)
    expect((await call('GET', oldBase, ownerCookie)).statusCode).toBe(404)
    // Put it back so the other tests keep their address.
    const back = await call('PATCH', `${oldBase}-two`, ownerCookie, { slug: acme.workspaceSlug })
    expect(back.statusCode).toBe(200)
  })

  it('saves the default retention for new teams and leaves existing teams alone', async () => {
    const url = `${workspace()}/settings`
    expect((await call('PATCH', url, ownerCookie, { retentionDays: 90 })).json().settings).toEqual({
      flakyBlocksMerge: true,
      retentionDays: 90,
    })
    expect((await call('PATCH', url, ownerCookie, { retentionDays: 0 })).statusCode).toBe(400)
    expect((await call('PATCH', url, memberCookie, { retentionDays: 5 })).statusCode).toBe(403)
    expect((await call('PATCH', url, rivalCookie, { retentionDays: 5 })).statusCode).toBe(404)
    const existing = (await call('GET', `${team()}/settings`, ownerCookie)).json()
    expect(existing.settings.retentionDays).toBe(30)
    expect(existing.workspace.retentionDays).toBe(90)
    await call('POST', `${workspace()}/teams`, ownerCookie, { name: 'Late team' })
    const late = (
      await call('GET', `${team().replace('/web', '/late-team')}/settings`, ownerCookie)
    ).json()
    expect(late.settings.retentionDays).toBe(90)
  })
})

describe('storage usage', () => {
  it('reports bytes by kind and by team with the retention settings, to members only', async () => {
    const build = await seedBuild(t.db, acme.team.id)
    await seedScreenshot(t.db, {
      buildId: build.id,
      fileSha256: sha('a'),
      size: 1000,
      thumbnailSha256: sha('b'),
      thumbnailSize: 100,
    })
    await seedSite(t.db, {
      teamId: acme.team.id,
      files: [{ path: 'index.html', sha256: sha('c'), size: 500 }],
    })
    const res = await call('GET', `${workspace()}/storage`, memberCookie)
    expect(res.statusCode).toBe(200)
    const usage = res.json()
    expect(usage).toMatchObject({ canManage: false, totalBytes: 1600, totalFiles: 3 })
    expect(usage.kinds).toEqual([
      { kind: 'screenshot', files: 1, bytes: 1000 },
      { kind: 'diff', files: 0, bytes: 0 },
      { kind: 'thumbnail', files: 1, bytes: 100 },
      { kind: 'site', files: 1, bytes: 500, versions: 1 },
    ])
    const web = usage.teams.find((p: { slug: string }) => p.slug === 'web')
    expect(web).toMatchObject({ bytes: 1600, files: 3, retentionDays: 30, color: 'plum' })
    expect(usage.defaultRetentionDays).toBe(90)

    // Outsiders get 404 and see none of it.
    expect((await call('GET', `${workspace()}/storage`, rivalCookie)).statusCode).toBe(404)
    const own = (
      await call('GET', `/api/workspaces/${rival.workspaceSlug}/storage`, rivalCookie)
    ).json()
    expect(own.totalBytes).toBe(0)
  })
})

describe('ignore regions page', () => {
  it('lists regions with who added them and the latest screenshot, and edits one', async () => {
    const build = await seedBuild(t.db, acme.team.id, { branch: 'main', status: 'complete' })
    await seedScreenshot(t.db, {
      buildId: build.id,
      name: 'checkout/summary',
      fileSha256: sha('d'),
      width: 1200,
      height: 800,
    })
    const region = { name: 'checkout/summary', x: 10, y: 20, width: 30, height: 40 }
    const created = await call('POST', `${team()}/ignore-regions`, memberCookie, region)
    expect(created.statusCode).toBe(201)
    expect(created.json()).toMatchObject({ ...region, createdBy: { name: 'Plain' } })

    const list = (await call('GET', `${team()}/ignore-regions`, ownerCookie)).json()
    expect(list.regions).toHaveLength(1)
    expect(list.regions[0].createdAt).toEqual(expect.any(String))
    expect(list.snapshots).toEqual([
      {
        name: 'checkout/summary',
        regions: 1,
        latest: { buildNumber: build.number, sha256: sha('d'), width: 1200, height: 800 },
      },
    ])

    const id = created.json().id
    const edited = await call('PATCH', `${team()}/ignore-regions/${id}`, ownerCookie, {
      x: 15,
      width: 50,
    })
    expect(edited.statusCode).toBe(200)
    expect(edited.json()).toMatchObject({
      x: 15,
      y: 20,
      width: 50,
      height: 40,
      createdBy: { name: 'Plain' },
    })
    expect(
      (await call('PATCH', `${team()}/ignore-regions/${id}`, ownerCookie, { width: 0 })).statusCode,
    ).toBe(400)
    expect(
      (await call('PATCH', `${team()}/ignore-regions/not-a-uuid`, ownerCookie, { x: 1 }))
        .statusCode,
    ).toBe(404)
    // Another workspace's member can neither see nor edit it.
    expect((await call('GET', `${team()}/ignore-regions`, rivalCookie)).statusCode).toBe(404)
    expect(
      (await call('PATCH', `${team()}/ignore-regions/${id}`, rivalCookie, { x: 1 })).statusCode,
    ).toBe(404)
    const [row] = await t.db
      .select()
      .from(schema.ignoreRegions)
      .where(eq(schema.ignoreRegions.id, id))
    expect(row?.x).toBe(15)
  })
})
