import { createUser } from '@circi/auth'
import { seedBuild } from '@circi/db/testing'
import { afterAll, describe, expect, it } from 'vitest'

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

const send = sender(() => app, acmeCookie)

const base = (workspace = acme.workspaceSlug) => `/api/projects/${workspace}/web`

describe('triage', () => {
  it('lists the queue to members only', async () => {
    const queue = await get(`${base()}/triage`, louCookie)
    expect(queue.statusCode).toBe(200)
    expect(queue.json().items).toBeInstanceOf(Array)
    expect((await get(`${base()}/triage`, rivalCookie)).statusCode).toBe(404)
    expect((await get(`${base()}/triage`, '')).statusCode).toBe(401)
  })

  it('lets any member assign, snooze and dismiss an item', async () => {
    const item = { kind: 'flaky', key: 'home' }
    const assigned = await send('POST', `${base()}/triage/assign`, {
      cookie: louCookie,
      payload: { ...item, assigneeId: lou.id },
    })
    expect(assigned.json()).toMatchObject({ ...item, assigneeId: lou.id, dismissed: false })

    const snoozed = await send('POST', `${base()}/triage/snooze`, {
      cookie: louCookie,
      payload: { ...item, choice: 'tomorrow' },
    })
    expect(snoozed.statusCode).toBe(200)
    expect(snoozed.json()).toMatchObject({ snoozeKind: 'tomorrow' })
    expect(Date.parse(snoozed.json().snoozedUntil)).toBeGreaterThan(Date.now())

    const past = await send('POST', `${base()}/triage/snooze`, {
      payload: { ...item, choice: 'date', date: '2020-01-01T00:00:00Z' },
    })
    expect(past.statusCode).toBe(400)

    const dismissed = await send('POST', `${base()}/triage/dismiss`, { payload: item })
    expect(dismissed.json()).toMatchObject({ dismissed: true })
  })

  it('wakes a snoozed item early, with an undo that snoozes it again', async () => {
    const item = { kind: 'flaky', key: 'unsnooze-me' }
    await send('POST', `${base()}/triage/snooze`, { payload: { ...item, choice: 'tomorrow' } })
    const woken = await send('POST', `${base()}/triage/unsnooze`, {
      cookie: louCookie,
      payload: item,
    })
    expect(woken.statusCode).toBe(200)
    expect(woken.json()).toMatchObject({
      ...item,
      snoozeKind: null,
      snoozedUntil: null,
      undo: { id: expect.any(String) },
    })
    const again = await send('POST', `${base()}/triage/unsnooze`, { payload: item })
    expect(again.json()).toMatchObject({ snoozeKind: null, undo: null })
    const undone = await send('POST', `${base()}/undo/${woken.json().undo.id}`, {
      cookie: louCookie,
    })
    expect(undone.statusCode).toBe(200)
    expect(
      (await send('POST', `${base()}/triage/unsnooze`, { payload: item })).json().undo,
    ).not.toBeNull()
    const stranger = await send('POST', `${base()}/triage/unsnooze`, {
      cookie: rivalCookie,
      payload: item,
    })
    expect(stranger.statusCode).toBe(404)
    const unknown = await send('POST', `${base()}/triage/unsnooze`, {
      payload: { kind: 'weird', key: 'x' },
    })
    expect(unknown.statusCode).toBe(400)
  })

  it('rejects assignees outside the workspace and unknown kinds', async () => {
    const outsider = await send('POST', `${base()}/triage/assign`, {
      payload: { kind: 'flaky', key: 'home', assigneeId: rival.owner.id },
    })
    expect(outsider.statusCode).toBe(400)
    const unknown = await send('POST', `${base()}/triage/dismiss`, {
      payload: { kind: 'weird', key: 'home' },
    })
    expect(unknown.statusCode).toBe(400)
  })

  it('lets any member compare a failed build again, once', async () => {
    const failed = await seedBuild(db, acme.project.id, { branch: 'main', status: 'error' })
    const queued = await send('POST', `${base()}/triage/rerun`, {
      cookie: louCookie,
      payload: { number: failed.number },
    })
    expect(queued.statusCode).toBe(200)
    expect(queued.json()).toEqual({ build: { number: failed.number, status: 'processing' } })
    const items = (await get(`${base()}/triage`)).json().items
    expect(items.some((i: { key: string }) => i.key === `build:${failed.number}`)).toBe(false)
    // It is processing now, so there is nothing failed to re-run.
    const again = await send('POST', `${base()}/triage/rerun`, {
      cookie: louCookie,
      payload: { number: failed.number },
    })
    expect(again.statusCode).toBe(404)
    expect(
      (await send('POST', `${base()}/triage/rerun`, { payload: { number: 0 } })).statusCode,
    ).toBe(400)
  })

  it('answers 404 to non-members on every action', async () => {
    for (const action of ['assign', 'snooze', 'dismiss', 'rerun']) {
      // oxlint-disable-next-line no-await-in-loop -- tiny fixed list
      const res = await send('POST', `${base()}/triage/${action}`, {
        cookie: rivalCookie,
        payload: { kind: 'flaky', key: 'home', assigneeId: null, choice: 'tomorrow', number: 1 },
      })
      expect(res.statusCode).toBe(404)
    }
  })
})
