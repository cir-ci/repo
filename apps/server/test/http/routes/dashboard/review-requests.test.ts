import { addMember, createUser } from '@circi/auth'
import { afterAll, describe, expect, it } from 'vitest'

import { startDashboard } from '#test/support/dashboard-fixture.ts'
import { ORIGIN, signIn } from '#test/support/helpers.ts'

const fx = await startDashboard()
const { app, auth, db, acme, rival, acmeCookie, rivalCookie, get } = fx
afterAll(() => fx.close())

const lou = await createUser(auth, {
  email: 'lou@acme.test',
  name: 'Lou',
  password: 'lou-password-long-1',
})
await addMember(auth, db, { orgSlug: acme.orgSlug, email: lou.email, role: 'member' })
const louCookie = await signIn(app, lou.email, 'lou-password-long-1')

const post = (
  url: string,
  options: { cookie?: string; payload?: unknown; origin?: string | null } = {},
) =>
  app.inject({
    method: 'POST',
    url,
    headers: {
      'content-type': 'application/json',
      ...(options.cookie === '' ? {} : { cookie: options.cookie ?? acmeCookie }),
      ...(options.origin === null ? {} : { origin: options.origin ?? ORIGIN }),
    },
    payload: options.payload ?? {},
  })

const requestUrl = (org = acme.orgSlug, build = 2) =>
  `/api/projects/${org}/web/builds/${build}/review-requests`
const list = async (tab: string, cookie = acmeCookie) =>
  (await get(`/api/reviews?tab=${tab}`, cookie)).json()
const ids = (body: { requests: { id: string }[] }) => body.requests.map((r) => r.id)

describe('review requests', () => {
  let requestId = ''

  it('lets a member ask a teammate, and asking twice finds the same request', async () => {
    const first = await post(requestUrl(), { payload: { reviewerId: lou.id } })
    expect(first.statusCode).toBe(201)
    expect(first.json()).toMatchObject({ state: 'open', created: true })
    // The project has the default 24 hour review target.
    expect(Date.parse(first.json().dueAt) - Date.now()).toBeGreaterThan(23 * 3_600_000)
    requestId = first.json().id

    const again = await post(requestUrl(), { payload: { reviewerId: lou.id } })
    expect(again.statusCode).toBe(200)
    expect(again.json()).toMatchObject({ id: requestId, created: false })
  })

  it('shows it to the reviewer under For you, and to the asker under Created by you', async () => {
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
        org: { slug: acme.orgSlug },
      },
    ])
    expect(ids(await list('created'))).toEqual([requestId])
    expect(ids(await list('created', louCookie))).toEqual([])
    expect(ids(await list('for-you'))).toEqual([])
    expect(ids(await list('snoozed', louCookie))).toEqual([])
  })

  it('keeps other organizations out of the lists and the actions', async () => {
    for (const tab of ['for-you', 'created', 'snoozed']) {
      // oxlint-disable-next-line no-await-in-loop -- tiny fixed list
      expect((await list(tab, rivalCookie)).requests).toEqual([])
    }
    const asked = await post(requestUrl(), { cookie: rivalCookie, payload: { reviewerId: lou.id } })
    const missing = await post(requestUrl(acme.orgSlug, 99), {
      cookie: rivalCookie,
      payload: { reviewerId: lou.id },
    })
    expect([asked.statusCode, missing.statusCode]).toEqual([404, 404])
    expect(asked.json()).toEqual(missing.json())

    const dismissed = await post(
      `/api/projects/${acme.orgSlug}/web/review-requests/${requestId}/dismiss`,
      { cookie: rivalCookie },
    )
    expect(dismissed.statusCode).toBe(404)
    expect(ids(await list('for-you', louCookie))).toEqual([requestId])
  })

  it('refuses a reviewer from another organization', async () => {
    const res = await post(requestUrl(), { payload: { reviewerId: rival.owner.id } })
    expect(res.statusCode).toBe(409)
    expect(res.json().error).toMatch(/not a member/)
  })

  it('needs a session and the dashboard’s own origin', async () => {
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
    const url = `/api/projects/${acme.orgSlug}/web/review-requests/${requestId}/dismiss`
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
    const reviewed = await post(`/api/projects/${acme.orgSlug}/web/builds/2/review`, {
      cookie: louCookie,
      payload: { state: 'rejected' },
    })
    expect(reviewed.statusCode).toBe(200)
    expect(ids(await list('for-you', louCookie))).toEqual([])
  })

  it('lets only the reviewer snooze and unsnooze a request', async () => {
    const made = await post(requestUrl(), { payload: { reviewerId: lou.id } })
    const id = made.json().id
    const base = `/api/projects/${acme.orgSlug}/web/review-requests/${id}`

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
    expect(res.json()).toEqual({ id, snoozeKind: 'next_push', snoozedUntil: null })
    expect(ids(await list('for-you', louCookie))).toEqual([])
    expect(ids(await list('snoozed', louCookie))).toEqual([id])

    expect((await post(`${base}/unsnooze`)).statusCode).toBe(404)
    expect((await post(`${base}/unsnooze`, { cookie: rivalCookie })).statusCode).toBe(404)
    const back = await post(`${base}/unsnooze`, { cookie: louCookie })
    expect(back.json()).toEqual({ id, snoozeKind: null, snoozedUntil: null })
    expect(ids(await list('for-you', louCookie))).toEqual([id])
  })
})
