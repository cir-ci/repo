import { addMember, createUser } from '@circi/auth'
import { afterAll, describe, expect, it } from 'vitest'

import { startDashboard } from '../../../support/dashboard-fixture.ts'
import { ORIGIN, signIn } from '../../../support/helpers.ts'

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

const send = (
  method: 'POST' | 'PUT' | 'DELETE',
  url: string,
  options: { cookie?: string; payload?: unknown } = {},
) =>
  app.inject({
    method,
    url,
    headers: {
      ...(method === 'DELETE' ? {} : { 'content-type': 'application/json' }),
      cookie: options.cookie ?? acmeCookie,
      origin: ORIGIN,
    },
    ...(method === 'DELETE' ? {} : { payload: options.payload ?? {} }),
  })

const base = (org = acme.orgSlug) => `/api/projects/${org}/web`

describe('review rules', () => {
  let ruleId = ''

  it('lets an owner create, edit and delete a rule, and shows it to members', async () => {
    const created = await send('POST', `${base()}/rules`, {
      payload: { kind: 'snapshot-name', pattern: 'checkout/**', reviewerIds: [lou.id] },
    })
    expect(created.statusCode).toBe(201)
    expect(created.json()).toMatchObject({
      kind: 'snapshot-name',
      pattern: 'checkout/**',
      reviewers: [{ id: lou.id, name: 'Lou' }],
    })
    ruleId = created.json().id

    const asMember = await get(`${base()}/rules`, louCookie)
    expect(asMember.statusCode).toBe(200)
    expect(asMember.json()).toMatchObject({
      canManage: false,
      rules: [{ id: ruleId }],
      rotation: { startsOn: null, members: [] },
    })
    expect((await get(`${base()}/rules`)).json().canManage).toBe(true)

    const edited = await send('PUT', `${base()}/rules/${ruleId}`, {
      payload: { kind: 'build-name', pattern: 'mobile-*', reviewerIds: [acme.owner.id] },
    })
    expect(edited.json()).toMatchObject({ kind: 'build-name', pattern: 'mobile-*' })

    expect((await send('DELETE', `${base()}/rules/${ruleId}`)).statusCode).toBe(204)
    expect((await send('DELETE', `${base()}/rules/${ruleId}`)).statusCode).toBe(404)
    expect((await send('DELETE', `${base()}/rules/not-a-uuid`)).statusCode).toBe(404)
  })

  it('rejects bad rules with 400', async () => {
    for (const payload of [
      { kind: 'snapshot-name', pattern: '', reviewerIds: [lou.id] },
      { kind: 'snapshot-name', pattern: 'x', reviewerIds: [] },
      { kind: 'regex', pattern: 'x', reviewerIds: [lou.id] },
      { kind: 'snapshot-name', pattern: 'x', reviewerIds: ['someone-else'] },
    ]) {
      // oxlint-disable-next-line no-await-in-loop -- tiny fixed list
      expect((await send('POST', `${base()}/rules`, { payload })).statusCode).toBe(400)
    }
  })

  it('is admin-only to change: members get 403, outsiders 404', async () => {
    const payload = { kind: 'snapshot-name', pattern: 'x', reviewerIds: [lou.id] }
    expect((await send('POST', `${base()}/rules`, { cookie: louCookie, payload })).statusCode).toBe(
      403,
    )
    expect(
      (
        await send('PUT', `${base()}/triage-rotation`, {
          cookie: louCookie,
          payload: { memberIds: [] },
        })
      ).statusCode,
    ).toBe(403)
    expect(
      (await send('POST', `${base()}/rules`, { cookie: rivalCookie, payload })).statusCode,
    ).toBe(404)
    expect((await get(`${base()}/rules`, rivalCookie)).statusCode).toBe(404)
    expect((await get(`${base()}/rules`, '')).statusCode).toBe(401)
  })

  it('does not let a rival organization reach the rule, or name its member', async () => {
    const mine = await send('POST', `${base()}/rules`, {
      payload: { kind: 'snapshot-name', pattern: 'y', reviewerIds: [lou.id] },
    })
    const foreign = await send('PUT', `${base(rival.orgSlug)}/rules/${mine.json().id}`, {
      cookie: rivalCookie,
      payload: { kind: 'snapshot-name', pattern: 'y', reviewerIds: [rival.owner.id] },
    })
    expect(foreign.statusCode).toBe(404)
    const outsider = await send('POST', `${base(rival.orgSlug)}/rules`, {
      cookie: rivalCookie,
      payload: { kind: 'snapshot-name', pattern: 'y', reviewerIds: [lou.id] },
    })
    expect(outsider.statusCode).toBe(400)
  })
})

describe('triage rotation', () => {
  it('is set by an admin and shows in the rules and the queue', async () => {
    const startsOn = '2026-03-09T00:00:00.000Z'
    const res = await send('PUT', `${base()}/triage-rotation`, {
      payload: { memberIds: [lou.id, acme.owner.id], startsOn },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({
      startsOn,
      members: [{ id: lou.id }, { id: acme.owner.id }],
    })
    const queue = (await get(`${base()}/triage`, louCookie)).json()
    expect(queue.rotation.members).toHaveLength(2)
    expect(queue.rotation.onTriage).not.toBeNull()
    expect(typeof queue.rotation.until).toBe('string')
  })
})

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

  it('rejects assignees outside the organization and unknown kinds', async () => {
    const outsider = await send('POST', `${base()}/triage/assign`, {
      payload: { kind: 'flaky', key: 'home', assigneeId: rival.owner.id },
    })
    expect(outsider.statusCode).toBe(400)
    const unknown = await send('POST', `${base()}/triage/dismiss`, {
      payload: { kind: 'weird', key: 'home' },
    })
    expect(unknown.statusCode).toBe(400)
  })

  it('answers 404 to non-members on every action', async () => {
    for (const action of ['assign', 'snooze', 'dismiss']) {
      // oxlint-disable-next-line no-await-in-loop -- tiny fixed list
      const res = await send('POST', `${base()}/triage/${action}`, {
        cookie: rivalCookie,
        payload: { kind: 'flaky', key: 'home', assigneeId: null, choice: 'tomorrow' },
      })
      expect(res.statusCode).toBe(404)
    }
  })
})

describe('ignore regions', () => {
  it('lets a member add and remove a region, and dismisses the triage item it answers', async () => {
    const created = await send('POST', `${base()}/ignore-regions`, {
      cookie: louCookie,
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

    const list = await get(`${base()}/ignore-regions`, louCookie)
    expect(list.json().regions).toMatchObject([{ id: created.json().id, name: 'home' }])

    const removed = await send('DELETE', `${base()}/ignore-regions/${created.json().id}`, {
      cookie: louCookie,
    })
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

  it('is hidden from non-members', async () => {
    const payload = { name: 'home', x: 0, y: 0, width: 5, height: 5 }
    expect(
      (await send('POST', `${base()}/ignore-regions`, { cookie: rivalCookie, payload })).statusCode,
    ).toBe(404)
    expect((await get(`${base()}/ignore-regions`, rivalCookie)).statusCode).toBe(404)
  })
})
