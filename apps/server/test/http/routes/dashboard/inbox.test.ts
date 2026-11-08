import { seedNotification } from '@circi/testing'
import { afterAll, describe, expect, it } from 'vitest'

import { startDashboard } from '../../../support/dashboard-fixture.ts'
import { ORIGIN } from '../../../support/helpers.ts'

const fx = await startDashboard()
const { app, db, acme, rival, acmeCookie, rivalCookie, get } = fx
afterAll(() => fx.close())

const send = (
  method: 'POST' | 'PUT' | 'DELETE',
  url: string,
  options: { cookie?: string; payload?: unknown; origin?: string | null } = {},
) =>
  app.inject({
    method,
    url,
    headers: {
      ...(method === 'DELETE' ? {} : { 'content-type': 'application/json' }),
      ...(options.cookie === '' ? {} : { cookie: options.cookie ?? acmeCookie }),
      ...(options.origin === null ? {} : { origin: options.origin ?? ORIGIN }),
    },
    ...(method === 'DELETE' ? {} : { payload: options.payload ?? {} }),
  })

const inbox = async (tab: string, cookie = acmeCookie) =>
  (await get(`/api/inbox?tab=${tab}`, cookie)).json()
const unread = async (cookie = acmeCookie) =>
  (await get('/api/inbox/unread-count', cookie)).json().unread

describe('inbox routes', () => {
  it('needs a session', async () => {
    expect((await get('/api/inbox', '')).statusCode).toBe(401)
    expect((await get('/api/inbox/unread-count', '')).statusCode).toBe(401)
  })

  it("lists the caller's notifications and the unread count", async () => {
    const mine = await seedNotification(db, {
      userId: acme.owner.id,
      kind: 'build_rejected',
      payload: { reason: 'clipped' },
    })
    await seedNotification(db, { userId: rival.owner.id, kind: 'mentioned' })
    const list = await inbox('for-you')
    expect(list).toMatchObject({ tab: 'for-you', unread: 1 })
    expect(list.items).toMatchObject([
      { id: mine.id, kind: 'build_rejected', payload: { reason: 'clipped' }, readAt: null },
    ])
    expect(await unread()).toBe(1)
    expect(await unread(rivalCookie)).toBe(1)
    expect((await get('/api/inbox?tab=bogus')).statusCode).toBe(400)
  })

  it('reads, unreads, snoozes, unsnoozes and deletes', async () => {
    const n = await seedNotification(db, { userId: acme.owner.id, kind: 'mentioned' })
    const before = await unread()

    const read = await send('POST', `/api/inbox/${n.id}/read`, { payload: { read: true } })
    expect(read.statusCode).toBe(200)
    expect(read.json().readAt).not.toBeNull()
    expect(await unread()).toBe(before - 1)
    const unreadAgain = await send('POST', `/api/inbox/${n.id}/read`, { payload: { read: false } })
    expect(unreadAgain.json().readAt).toBeNull()

    const snoozed = await send('POST', `/api/inbox/${n.id}/snooze`, {
      payload: { choice: 'tomorrow' },
    })
    expect(snoozed.json().snoozedUntil).not.toBeNull()
    expect((await inbox('everything')).items.map((i: { id: string }) => i.id)).not.toContain(n.id)
    expect((await inbox('snoozed')).items.map((i: { id: string }) => i.id)).toEqual([n.id])
    expect(
      (await send('POST', `/api/inbox/${n.id}/snooze`, { payload: { choice: 'date' } })).statusCode,
    ).toBe(400)
    expect(
      (await send('POST', `/api/inbox/${n.id}/snooze`, { payload: { choice: 'next_push' } }))
        .statusCode,
    ).toBe(400)

    expect((await send('POST', `/api/inbox/${n.id}/unsnooze`)).json().snoozedUntil).toBeNull()
    expect((await send('DELETE', `/api/inbox/${n.id}`)).statusCode).toBe(204)
    expect((await inbox('everything')).items.map((i: { id: string }) => i.id)).not.toContain(n.id)
    expect((await send('DELETE', `/api/inbox/${n.id}`)).statusCode).toBe(404)
  })

  it('marks everything read', async () => {
    await seedNotification(db, { userId: acme.owner.id })
    expect((await send('POST', '/api/inbox/read-all')).json().marked).toBeGreaterThan(0)
    expect(await unread()).toBe(0)
  })

  it("never lets one user touch another's notification", async () => {
    const theirs = await seedNotification(db, { userId: rival.owner.id, kind: 'mentioned' })
    const rivalUnread = await unread(rivalCookie)
    expect((await inbox('everything')).items.map((i: { id: string }) => i.id)).not.toContain(
      theirs.id,
    )
    for (const res of [
      await send('POST', `/api/inbox/${theirs.id}/read`, { payload: { read: true } }),
      await send('POST', `/api/inbox/${theirs.id}/snooze`, { payload: { choice: 'tomorrow' } }),
      await send('POST', `/api/inbox/${theirs.id}/unsnooze`),
      await send('DELETE', `/api/inbox/${theirs.id}`),
    ]) {
      expect(res.statusCode).toBe(404)
    }
    expect((await send('POST', '/api/inbox/read-all')).statusCode).toBe(200)
    // Still there and unread for its owner.
    expect(await unread(rivalCookie)).toBe(rivalUnread)
  })

  it('refuses changes from another origin', async () => {
    const n = await seedNotification(db, { userId: acme.owner.id })
    const res = await send('POST', `/api/inbox/${n.id}/read`, {
      payload: { read: true },
      origin: 'https://evil.example',
    })
    expect(res.statusCode).toBe(403)
  })

  it('keeps email preferences per person, on by default', async () => {
    expect((await get('/api/inbox/preferences')).json()).toEqual({
      emailReviewRequested: true,
      emailReviewOverdue: true,
    })
    const put = await send('PUT', '/api/inbox/preferences', {
      payload: { emailReviewRequested: false },
    })
    expect(put.json()).toEqual({ emailReviewRequested: false, emailReviewOverdue: true })
    expect((await get('/api/inbox/preferences', rivalCookie)).json().emailReviewRequested).toBe(
      true,
    )
    expect((await send('PUT', '/api/inbox/preferences', { payload: { nope: 1 } })).statusCode).toBe(
      400,
    )
  })
})
