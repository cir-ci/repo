import { addMember, createUser } from '@circi/auth'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

import { sender } from '#test/support/client.ts'
import { startDashboard } from '#test/support/dashboard-fixture.ts'
import { signIn } from '#test/support/helpers.ts'

const fx = await startDashboard()
const { app, auth, db, acme, rival, acmeCookie, rivalCookie, get } = fx
afterAll(() => fx.close())

const lou = await createUser(auth, {
  email: 'lou@acme.test',
  name: 'Lou',
  password: 'lou-password-long-1',
})
await addMember(auth, db, { workspaceSlug: acme.workspaceSlug, email: lou.email, role: 'member' })
const louCookie = await signIn(app, lou.email, 'lou-password-long-1')

const base = (workspace = acme.workspaceSlug, build = 2) =>
  `/api/teams/${workspace}/web/builds/${build}`
const build = `/api/teams/${acme.workspaceSlug}/web/builds/2`
const reset = await fx.snapshot()
beforeEach(reset)
const send = sender(() => app, acmeCookie)
const comments = async (cookie = acmeCookie) => (await get(`${build}/comments`, cookie)).json()

const bad = (payload: unknown) => send('POST', `${build}/comments`, { payload })

describe('comment routes', () => {
  it('hides the build from non-members and signed-out visitors', async () => {
    expect((await get(`${base()}/comments`, rivalCookie)).statusCode).toBe(404)
    expect((await get(`${base()}/comments`, '')).statusCode).toBe(401)
    const post = await send('POST', `${base()}/comments`, {
      cookie: rivalCookie,
      payload: { body: 'hi' },
    })
    expect(post.statusCode).toBe(404)
    expect((await get(`${base()}/activity`, rivalCookie)).statusCode).toBe(404)
    expect((await get(`${base(acme.workspaceSlug, 99)}/comments`)).statusCode).toBe(404)
    expect((await get(`${base(rival.workspaceSlug)}/comments`)).statusCode).toBe(404)
  })

  it('creates comments and replies, mentions notify, and lists them oldest first', async () => {
    const top = await send('POST', `${build}/comments`, {
      payload: {
        body: '@lou is this intended?',
        snapshotName: 'home',
        region: { x: 0.1, y: 0.1, width: 0.5, height: 0.5 },
      },
    })
    expect(top.statusCode).toBe(201)
    const reply = await send('POST', `${build}/comments`, {
      cookie: louCookie,
      payload: { body: 'yes', parentId: top.json().id },
    })
    expect(reply.statusCode).toBe(201)

    const list = await comments(louCookie)
    expect(list.comments).toMatchObject([
      {
        id: top.json().id,
        region: { x: 0.1 },
        mine: false,
        canDelete: false,
        author: { name: 'Owner 1' },
      },
      {
        id: reply.json().id,
        parentId: top.json().id,
        snapshotName: 'home',
        mine: true,
        canDelete: true,
      },
    ])
    const inbox = (await get('/api/inbox?tab=for-you', louCookie)).json()
    expect(inbox.items).toMatchObject([
      { kind: 'mentioned', payload: { commentId: top.json().id } },
    ])
  })

  it('rejects bad regions and empty bodies', async () => {
    expect((await bad({ body: '   ' })).statusCode).toBe(400)
    expect(
      (
        await bad({
          body: 'x',
          snapshotName: 'home',
          region: { x: 0.8, y: 0, width: 0.5, height: 1 },
        })
      ).statusCode,
    ).toBe(400)
    expect(
      (await bad({ body: 'x', region: { x: 0, y: 0, width: 0.5, height: 0.5 } })).statusCode,
    ).toBe(400)
  })

  it('lets only the author edit, and the author or an admin delete', async () => {
    const mine = await send('POST', `${build}/comments`, {
      cookie: louCookie,
      payload: { body: 'from lou' },
    })
    const url = `${build}/comments/${mine.json().id}`
    expect((await send('PATCH', url, { payload: { body: 'hijack' } })).statusCode).toBe(403)
    const edited = await send('PATCH', url, { cookie: louCookie, payload: { body: 'fixed' } })
    expect(edited.statusCode).toBe(200)
    expect(edited.json()).toMatchObject({ body: 'fixed' })
    expect(edited.json().editedAt).not.toBeNull()

    const theirs = await send('POST', `${build}/comments`, { payload: { body: 'from owner' } })
    const theirsUrl = `${build}/comments/${theirs.json().id}`
    expect((await send('DELETE', theirsUrl, { cookie: louCookie })).statusCode).toBe(403)
    expect((await send('DELETE', theirsUrl, { cookie: rivalCookie })).statusCode).toBe(404)
    // Lou's own comment: the owner (an admin) may delete it, and it stays as a blank placeholder.
    expect((await send('DELETE', url)).statusCode).toBe(204)
    expect((await send('DELETE', url)).statusCode).toBe(404)
    expect((await send('DELETE', theirsUrl)).statusCode).toBe(204)
    const gone = (await comments()).comments.find((c: { id: string }) => c.id === mine.json().id)
    expect(gone).toMatchObject({ body: '', canDelete: false })
    expect(gone.deletedAt).not.toBeNull()
  })

  it('shows decisions with their reason and comments in the activity timeline', async () => {
    const top = await send('POST', `${build}/comments`, { payload: { body: 'is this intended?' } })
    await send('POST', `${build}/comments`, {
      cookie: louCookie,
      payload: { body: 'yes', parentId: top.json().id },
    })
    const gone = await send('POST', `${build}/comments`, { payload: { body: 'oops' } })
    await send('DELETE', `${build}/comments/${gone.json().id}`)
    const reject = await send('POST', `${build}/review`, {
      payload: { state: 'rejected', reason: 'hero is cropped' },
    })
    expect(reject.statusCode).toBe(200)
    const { events } = (await get(`${build}/activity`, louCookie)).json()
    const types = events.map((e: { type: string }) => e.type)
    expect(types[0]).toBe('uploaded')
    expect(types).toContain('comment')
    expect(
      events.find(
        (e: { type: string; state?: string }) => e.type === 'review' && e.state === 'rejected',
      ),
    ).toMatchObject({
      state: 'rejected',
      reason: 'hero is cropped',
      by: { name: 'Owner 1' },
    })
    const times = events.map((e: { at: string }) => Date.parse(e.at))
    expect(times).toEqual([...times].toSorted((a, b) => a - b))
    // Deleted comments are not part of the activity.
    expect(events.filter((e: { type: string }) => e.type === 'comment')).toHaveLength(2)
  })
})
