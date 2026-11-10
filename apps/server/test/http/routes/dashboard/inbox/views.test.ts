import { teamColorFor } from '@circi/core'
import { getWorkspaceBySlug } from '@circi/db/queries'
import * as schema from '@circi/db/schema'
import { addTestMember, seedSavedView, seedUser } from '@circi/db/testing'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

import { sender } from '#test/support/client.ts'
import { startDashboard } from '#test/support/dashboard-fixture.ts'

const fx = await startDashboard()
const { app, db, acme, rival, acmeCookie, rivalCookie, get } = fx
afterAll(() => fx.close())

const send = sender(() => app, acmeCookie)

const views = `/api/workspaces/${acme.workspaceSlug}/views`
const bad = (payload: unknown) => send('POST', views, { payload })

const reset = await fx.snapshot()
beforeEach(reset)

describe('saved view routes', () => {
  it('needs a session, and a workspace you belong to', async () => {
    expect((await get(views, '')).statusCode).toBe(401)
    expect((await get(views, rivalCookie)).statusCode).toBe(404)
    expect((await get('/api/workspaces/nope/views')).statusCode).toBe(404)
    expect(
      (await send('POST', views, { cookie: rivalCookie, payload: { name: 'x', filters: {} } }))
        .statusCode,
    ).toBe(404)
    expect(
      (await get(`/api/workspaces/${acme.workspaceSlug}/sidebar`, rivalCookie)).statusCode,
    ).toBe(404)
    expect(
      (
        await send('PUT', `/api/workspaces/${acme.workspaceSlug}/pinned-teams/web`, {
          cookie: rivalCookie,
        })
      ).statusCode,
    ).toBe(404)
  })

  it('creates, lists, patches and deletes a view', async () => {
    const created = await send('POST', views, {
      payload: { name: 'Failing', team: 'web', filters: { status: 'error', branch: 'main' } },
    })
    expect(created.statusCode).toBe(201)
    const view = created.json()
    expect(view).toMatchObject({
      name: 'Failing',
      pinned: false,
      team: { slug: 'web' },
      filters: { status: 'error', branch: 'main' },
    })
    expect((await get(views)).json().views.map((v: { id: string }) => v.id)).toEqual([view.id])

    const patched = await send('PATCH', `${views}/${view.id}`, {
      payload: { name: 'Broken', pinned: true, filters: { review: 'pending' } },
    })
    expect(patched.json()).toMatchObject({
      name: 'Broken',
      pinned: true,
      filters: { review: 'pending' },
    })

    expect((await send('DELETE', `${views}/${view.id}`)).statusCode).toBe(204)
    expect((await get(views)).json().views).toEqual([])
    expect((await send('DELETE', `${views}/${view.id}`)).statusCode).toBe(404)
  })

  it('validates filters with the builds list definition, and names', async () => {
    expect((await bad({ name: 'x', filters: { status: 'bogus' } })).statusCode).toBe(400)
    expect((await bad({ name: 'x', filters: { colour: 'red' } })).statusCode).toBe(400)
    expect((await bad({ name: 'x', filters: { from: 'yesterday' } })).statusCode).toBe(400)
    expect((await bad({ name: '', filters: {} })).statusCode).toBe(400)
    expect((await bad({ name: 'x', team: 'missing', filters: {} })).statusCode).toBe(404)
    expect((await bad({ name: 'Dup', filters: {} })).statusCode).toBe(201)
    expect((await bad({ name: 'Dup', filters: {} })).statusCode).toBe(409)
  })

  it("treats another user's view as not found", async () => {
    const mate = await addMate()
    const theirs = await seedSavedView(db, {
      userId: mate.id,
      workspaceId: await workspaceId(),
      name: 'Theirs',
    })
    expect((await get(views)).json().views.map((v: { name: string }) => v.name)).not.toContain(
      'Theirs',
    )
    expect(
      (await send('PATCH', `${views}/${theirs.id}`, { payload: { name: 'Mine now' } })).statusCode,
    ).toBe(404)
    expect((await send('DELETE', `${views}/${theirs.id}`)).statusCode).toBe(404)
    // A view of the rival's, addressed through the rival's own workspace, is not reachable here.
    const ours = (await send('POST', views, { payload: { name: 'Ours', filters: {} } })).json()
    expect(
      (
        await send('PATCH', `/api/workspaces/${rival.workspaceSlug}/views/${ours.id}`, {
          cookie: rivalCookie,
          payload: { name: 'x' },
        })
      ).statusCode,
    ).toBe(404)
  })

  it('reorders views', async () => {
    for (const name of ['One', 'Two', 'Three']) {
      // oxlint-disable-next-line no-await-in-loop -- created in order
      expect((await send('POST', views, { payload: { name, filters: {} } })).statusCode).toBe(201)
    }
    const list: { id: string }[] = (await get(views)).json().views
    const ids = list.map((v) => v.id).toReversed()
    const out = await send('PUT', `${views}/order`, { payload: { ids } })
    expect(out.statusCode).toBe(200)
    expect(out.json().views.map((v: { id: string }) => v.id)).toEqual(ids)
    expect(
      (await send('PUT', `${views}/order`, { payload: { ids: ids.slice(1) } })).statusCode,
    ).toBe(400)
  })

  it("counts a team's sites in the sidebar, so the Sites entry shows only when there are some", async () => {
    const count = async () =>
      (await get(`/api/workspaces/${acme.workspaceSlug}/sidebar`)).json().teams[0].siteCount
    expect(await count()).toBe(0)
    await db
      .insert(schema.teamSites)
      .values({ teamId: acme.team.id, name: 'Storybook', kind: 'storybook', slug: 'sb-views-1' })
    expect(await count()).toBe(1)
  })

  it('pins and unpins a team, and the sidebar reflects it', async () => {
    const pin = `/api/workspaces/${acme.workspaceSlug}/pinned-teams/web`
    expect(
      (await send('POST', views, { payload: { name: 'Failing', filters: {} } })).statusCode,
    ).toBe(201)
    expect((await send('PUT', pin)).json()).toEqual({ pinned: true, changed: true })
    expect((await send('PUT', pin)).json()).toEqual({ pinned: true, changed: false })
    const bar = (await get(`/api/workspaces/${acme.workspaceSlug}/sidebar`)).json()
    expect(bar.teams).toEqual([
      {
        slug: 'web',
        name: 'web',
        color: teamColorFor('web'),
        icon: null,
        pinned: true,
        triage: 0,
        memberCount: 1,
        memberPreview: [expect.objectContaining({ id: acme.owner.id, image: null })],
        siteCount: 0,
        youAreMember: true,
      },
    ])
    expect(bar).toMatchObject({ inboxUnread: 0, reviews: 0, canManage: true })
    expect(bar.views.length).toBeGreaterThan(0)
    expect((await send('DELETE', pin)).json()).toEqual({ pinned: false, changed: true })
    expect(
      (await get(`/api/workspaces/${acme.workspaceSlug}/sidebar`)).json().teams[0].pinned,
    ).toBe(false)
    expect(
      (await send('PUT', `/api/workspaces/${acme.workspaceSlug}/pinned-teams/nope`)).statusCode,
    ).toBe(404)
  })
})

async function workspaceId() {
  return (await getWorkspaceBySlug(db, acme.workspaceSlug)).id
}
async function addMate() {
  const u = await seedUser(db)
  await addTestMember(db, { workspaceId: await workspaceId(), userId: u.id })
  return u
}
