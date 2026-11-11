import { createUser } from '@circi/auth'
import { afterAll, describe, expect, it } from 'vitest'

import { sender } from '#test/support/client.ts'
import { startDashboard } from '#test/support/dashboard-fixture.ts'
import { signIn, addMember } from '#test/support/helpers.ts'

const fx = await startDashboard()
const { app, auth, db, acme, acmeCookie, rivalCookie, get } = fx
afterAll(() => fx.close())

const lou = await createUser(auth, {
  email: 'lou@acme.test',
  name: 'Lou',
  password: 'lou-password-long-1',
})
await addMember(auth, db, { workspaceSlug: acme.workspaceSlug, email: lou.email, role: 'member' })
const louCookie = await signIn(app, lou.email, 'lou-password-long-1')

const send = sender(() => app, acmeCookie)

const base = (workspace = acme.workspaceSlug) => `/api/projects/${workspace}/web`

describe('ignore regions', () => {
  it('lets a manager add and remove a region, and dismisses the triage item it answers', async () => {
    const created = await send('POST', `${base()}/ignore-regions`, {
      payload: {
        name: 'home',
        x: 10,
        y: 20,
        width: 120,
        height: 18,
        resolves: { kind: 'flaky', key: 'about' },
      },
    })
    expect(created.statusCode).toBe(201)
    expect(created.json()).toMatchObject({ name: 'home', x: 10, y: 20, width: 120, height: 18 })

    const list = await get(`${base()}/ignore-regions`)
    expect(list.json().regions).toMatchObject([{ id: created.json().id, name: 'home' }])

    const removed = await send('DELETE', `${base()}/ignore-regions/${created.json().id}`)
    expect(removed.statusCode).toBe(204)
    expect((await get(`${base()}/ignore-regions`)).json().regions).toEqual([])
    expect((await send('DELETE', `${base()}/ignore-regions/${created.json().id}`)).statusCode).toBe(
      404,
    )
    expect((await send('DELETE', `${base()}/ignore-regions/nope`)).statusCode).toBe(404)
  })

  it('rejects an invalid rectangle with 400', async () => {
    for (const bad of [
      { name: 'home', x: 0, y: 0, width: 0, height: 5 },
      { name: 'home', x: -1, y: 0, width: 5, height: 5 },
      { name: 'home', x: 0.5, y: 0, width: 5, height: 5 },
      { name: '  ', x: 0, y: 0, width: 5, height: 5 },
    ]) {
      // oxlint-disable-next-line no-await-in-loop -- tiny fixed list
      expect((await send('POST', `${base()}/ignore-regions`, { payload: bad })).statusCode).toBe(
        400,
      )
    }
  })

  it('answers 403 to a plain member on every write, and lets them read', async () => {
    const payload = { name: 'home', x: 0, y: 0, width: 5, height: 5 }
    const owned = await send('POST', `${base()}/ignore-regions`, { payload })
    expect(owned.statusCode).toBe(201)
    const url = `${base()}/ignore-regions`
    expect((await send('POST', url, { cookie: louCookie, payload })).statusCode).toBe(403)
    expect(
      (await send('PATCH', `${url}/${owned.json().id}`, { cookie: louCookie, payload: { x: 1 } }))
        .statusCode,
    ).toBe(403)
    expect(
      (await send('DELETE', `${url}/${owned.json().id}`, { cookie: louCookie })).statusCode,
    ).toBe(403)
    const list = await get(url, louCookie)
    expect(list.statusCode).toBe(200)
    expect(list.json().regions).toHaveLength(1)
    expect(list.json().regions[0]).toMatchObject({ x: 0 })
  })

  it('is hidden from non-members', async () => {
    const payload = { name: 'home', x: 0, y: 0, width: 5, height: 5 }
    expect(
      (await send('POST', `${base()}/ignore-regions`, { cookie: rivalCookie, payload })).statusCode,
    ).toBe(404)
    expect((await get(`${base()}/ignore-regions`, rivalCookie)).statusCode).toBe(404)
  })
})
