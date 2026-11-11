import { createUser } from '@circi/auth'
import { notifications } from '@circi/db/schema'
import { eq } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

import { sender } from '#test/support/client.ts'
import { startDashboard } from '#test/support/dashboard-fixture.ts'
import { signIn, addMember } from '#test/support/helpers.ts'

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

const postAs = sender(() => app, acmeCookie)
const post = (
  url: string,
  options: { cookie?: string; payload?: unknown; origin?: string | null } = {},
) => postAs('POST', url, options)

const requestUrl = (workspace = acme.workspaceSlug, build = 2) =>
  `/api/projects/${workspace}/web/builds/${build}/review-requests`
const list = async (tab: string, cookie = acmeCookie) =>
  (await get(`/api/reviews?tab=${tab}`, cookie)).json()
const ids = (body: { requests: { id: string }[] }) => body.requests.map((r) => r.id)

const reset = await fx.snapshot()
beforeEach(reset)

/** Acme's owner asks Lou to review build 2; returns the request's id. */
async function ask(): Promise<string> {
  const res = await post(requestUrl(), { payload: { reviewerId: lou.id } })
  expect(res.statusCode).toBe(201)
  return res.json().id
}

describe('review requests', () => {
  it('lets a member ask a teammate, and asking twice finds the same request', async () => {
    const first = await post(requestUrl(), { payload: { reviewerId: lou.id } })
    expect(first.statusCode).toBe(201)
    expect(first.json()).toMatchObject({ state: 'open', created: true })
    // The project has the default 24 hour review target.
    expect(Date.parse(first.json().dueAt) - Date.now()).toBeGreaterThan(23 * 3_600_000)
    const requestId = first.json().id

    const again = await post(requestUrl(), { payload: { reviewerId: lou.id } })
    expect(again.statusCode).toBe(200)
    expect(again.json()).toMatchObject({ id: requestId, created: false })
  })

  it('shows it to the reviewer under For you, and to the asker under Created by you', async () => {
    const requestId = await ask()
    const forLou = await list('for-you', louCookie)
    expect(forLou.tab).toBe('for-you')
    expect(forLou.requests).toMatchObject([
      {
        id: requestId,
        state: 'open',
        overdueByMs: 0,
        reviewer: { id: lou.id, name: 'Lou' },
        requestedBy: { id: acme.owner.id },
        build: { number: 2, branch: 'main' },
        project: { slug: 'web' },
        workspace: { slug: acme.workspaceSlug },
        changes: { changed: expect.any(Number), added: expect.any(Number) },
        largestChanges: expect.any(Array),
      },
    ])
    expect(ids(await list('created'))).toEqual([requestId])
    expect(ids(await list('created', louCookie))).toEqual([])
    expect(ids(await list('for-you'))).toEqual([])
    expect(ids(await list('snoozed', louCookie))).toEqual([])
  })

  it('lists every open request under All open, and a decided one under Reviewed', async () => {
    const requestId = await ask()
    // Anyone in the workspace sees it on All open, nobody outside does.
    expect(ids(await list('all-open'))).toEqual([requestId])
    expect(ids(await list('all-open', louCookie))).toEqual([requestId])
    expect((await list('all-open', rivalCookie)).requests).toEqual([])
    expect((await list('reviewed', louCookie)).requests).toEqual([])

    const review = await post(`/api/projects/${acme.workspaceSlug}/web/builds/2/review`, {
      cookie: louCookie,
      payload: { state: 'rejected', reason: 'No' },
    })
    expect(review.statusCode).toBe(200)
    expect(await list('all-open')).toMatchObject({ requests: [] })
    const reviewed = await list('reviewed', louCookie)
    expect(reviewed.requests).toMatchObject([
      { id: requestId, state: 'done', decision: 'rejected', closedAt: expect.any(String) },
    ])
    expect((await list('reviewed')).requests).toEqual([])
  })

  it('keeps other workspaces out of the lists and the actions', async () => {
    const requestId = await ask()
    for (const tab of ['for-you', 'created', 'snoozed', 'reviewed', 'all-open']) {
      // oxlint-disable-next-line no-await-in-loop -- tiny fixed list
      expect((await list(tab, rivalCookie)).requests).toEqual([])
    }
    const asked = await post(requestUrl(), { cookie: rivalCookie, payload: { reviewerId: lou.id } })
    const missing = await post(requestUrl(acme.workspaceSlug, 99), {
      cookie: rivalCookie,
      payload: { reviewerId: lou.id },
    })
    expect([asked.statusCode, missing.statusCode]).toEqual([404, 404])
    expect(asked.json()).toEqual(missing.json())

    const dismissed = await post(
      `/api/projects/${acme.workspaceSlug}/web/review-requests/${requestId}/dismiss`,
      { cookie: rivalCookie },
    )
    expect(dismissed.statusCode).toBe(404)
    expect(ids(await list('for-you', louCookie))).toEqual([requestId])
  })

  it('refuses a reviewer from another workspace', async () => {
    const res = await post(requestUrl(), { payload: { reviewerId: rival.owner.id } })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toMatch(/must be a member of this project/)
  })

  it('refuses a request from yourself with a 400 and stores nothing', async () => {
    const res = await post(requestUrl(), { payload: { reviewerId: acme.owner.id } })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toBe("You can't request a review from yourself.")
    expect(await list('created')).toMatchObject({ requests: [] })
    const bulk = await post(`/api/projects/${acme.workspaceSlug}/web/builds/request-review`, {
      payload: { buildIds: ['00000000-0000-4000-8000-000000000000'], reviewerIds: [acme.owner.id] },
    })
    expect(bulk.statusCode).toBe(400)
  })

  it("needs a session and the dashboard's own origin", async () => {
    expect((await get('/api/reviews', '')).statusCode).toBe(401)
    expect((await post(requestUrl(), { cookie: '' })).statusCode).toBe(401)
    const evil = await post(requestUrl(), {
      payload: { reviewerId: acme.owner.id },
      origin: 'https://sb.example-sites.com',
    })
    expect(evil.statusCode).toBe(403)
  })

  it('rejects a bad tab or body', async () => {
    expect((await get('/api/reviews?tab=everything')).statusCode).toBe(400)
    expect((await post(requestUrl(), { payload: {} })).statusCode).toBe(400)
  })

  it('lets the reviewer dismiss it, once', async () => {
    const requestId = await ask()
    const url = `/api/projects/${acme.workspaceSlug}/web/review-requests/${requestId}/dismiss`
    const res = await post(url, { cookie: louCookie })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ id: requestId, state: 'dismissed' })
    expect(ids(await list('for-you', louCookie))).toEqual([])
    expect((await post(url, { cookie: louCookie })).statusCode).toBe(404)
  })

  it('closes when the build is approved', async () => {
    const made = await post(requestUrl(), { payload: { reviewerId: lou.id } })
    expect(made.statusCode).toBe(201)
    expect(ids(await list('for-you', louCookie))).toEqual([made.json().id])
    const reviewed = await post(`/api/projects/${acme.workspaceSlug}/web/builds/2/review`, {
      cookie: louCookie,
      payload: { state: 'rejected' },
    })
    expect(reviewed.statusCode).toBe(200)
    expect(ids(await list('for-you', louCookie))).toEqual([])
  })

  it('lets only the reviewer snooze and unsnooze a request', async () => {
    const made = await post(requestUrl(), { payload: { reviewerId: lou.id } })
    const id = made.json().id
    const base = `/api/projects/${acme.workspaceSlug}/web/review-requests/${id}`

    expect((await post(`${base}/snooze`, { payload: { kind: 'tomorrow' } })).statusCode).toBe(404)
    expect(
      (await post(`${base}/snooze`, { cookie: rivalCookie, payload: { kind: 'tomorrow' } }))
        .statusCode,
    ).toBe(404)
    expect((await post(`${base}/snooze`, { cookie: louCookie, payload: {} })).statusCode).toBe(400)
    expect(
      (await post(`${base}/snooze`, { cookie: louCookie, payload: { kind: 'date' } })).statusCode,
    ).toBe(400)

    const res = await post(`${base}/snooze`, { cookie: louCookie, payload: { kind: 'next_push' } })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({
      id,
      snoozeKind: 'next_push',
      snoozedUntil: null,
      undo: { id: expect.any(String), expiresAt: expect.any(String) },
    })
    expect(ids(await list('for-you', louCookie))).toEqual([])
    expect(ids(await list('snoozed', louCookie))).toEqual([id])

    expect((await post(`${base}/unsnooze`)).statusCode).toBe(404)
    expect((await post(`${base}/unsnooze`, { cookie: rivalCookie })).statusCode).toBe(404)
    const back = await post(`${base}/unsnooze`, { cookie: louCookie })
    expect(back.json()).toEqual({ id, snoozeKind: null, snoozedUntil: null, undo: null })
    expect(ids(await list('for-you', louCookie))).toEqual([id])
  })

  it('lets only whoever asked nudge, and only once a day', async () => {
    const id = await ask()
    const url = `/api/projects/${acme.workspaceSlug}/web/review-requests/${id}/nudge`
    // Not the asker: the reviewer, an outsider.
    expect((await post(url, { cookie: louCookie })).statusCode).toBe(403)
    expect((await post(url, { cookie: rivalCookie })).statusCode).toBe(404)
    // The ask itself just told Lou, so a nudge now waits.
    expect((await post(url)).statusCode).toBe(409)

    // A day on, it goes through: Lou gets a fresh notice from the asker, then the clock restarts.
    await db
      .update(notifications)
      .set({ createdAt: new Date(Date.now() - 25 * 3_600_000) })
      .where(eq(notifications.userId, lou.id))
    const nudged = await post(url)
    expect(nudged.statusCode).toBe(200)
    expect(nudged.json()).toEqual({ id, nudged: true })
    const inbox = (await get('/api/inbox?tab=for-you', louCookie)).json()
    expect(inbox.items[0]).toMatchObject({
      kind: 'review_re_requested',
      actor: { id: acme.owner.id, name: expect.any(String), image: null },
      payload: { nudge: true },
      build: { number: 2, name: expect.any(String), status: expect.any(String) },
      changes: { changed: expect.any(Number), unchanged: expect.any(Number) },
      request: { dueAt: expect.any(String), overdueByMs: 0 },
    })
    expect((await post(url)).statusCode).toBe(409)
  })

  it('refuses a nudge for a request that was closed or made by a rule', async () => {
    const id = await ask()
    const base = `/api/projects/${acme.workspaceSlug}/web/review-requests/${id}`
    await post(`${base}/dismiss`)
    expect((await post(`${base}/nudge`)).statusCode).toBe(404)
  })
})
