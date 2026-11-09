import { verifyTeamToken } from '@circi/auth'
import { teamColorFor } from '@circi/core'
import { schema } from '@circi/db'
import { seedBuild, seedScreenshot, fakeSha } from '@circi/testing'
import { eq } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

import { caller } from '#test/support/client.ts'
import { startPages } from '#test/support/pages-fixture.ts'

/** The team page endpoints: appearance, CI token, ignore regions. */

const fx = await startPages()
const { app, t, auth, acme, ownerCookie, memberCookie, rivalCookie } = fx
afterAll(() => fx.close())
const reset = await fx.snapshot()
beforeEach(reset)

const team = () => `/api/teams/${acme.workspaceSlug}/web`
const workspace = () => `/api/workspaces/${acme.workspaceSlug}`
const call = caller(() => app)

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
    expect(
      (await call('PATCH', `${team()}/appearance`, ownerCookie, { color: 'plum' })).statusCode,
    ).toBe(200)
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

describe('ignore regions page', () => {
  it('lists regions with who added them and the latest screenshot, and edits one', async () => {
    const build = await seedBuild(t.db, acme.team.id, { branch: 'main', status: 'complete' })
    await seedScreenshot(t.db, {
      buildId: build.id,
      name: 'checkout/summary',
      fileSha256: fakeSha('d'),
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
        latest: { buildNumber: build.number, sha256: fakeSha('d'), width: 1200, height: 800 },
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
