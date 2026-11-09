import { addMember, createUser } from '@circi/auth'
import { afterAll, describe, expect, it } from 'vitest'

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

const send = sender(() => app, acmeCookie)

const base = (workspace = acme.workspaceSlug) => `/api/teams/${workspace}/web`

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

  it('reorders rules for managers only, all at once', async () => {
    const make = async (pattern: string) =>
      (
        await send('POST', `${base()}/rules`, {
          payload: { kind: 'snapshot-name', pattern, reviewerIds: [lou.id] },
        })
      ).json().id
    const [a, b] = [await make('first/**'), await make('second/**')]
    const order = (ids: string[]) =>
      send('PUT', `${base()}/rules/order`, { payload: { ruleIds: ids } })
    const res = await order([b, a])
    expect(res.statusCode).toBe(200)
    expect(res.json().rules.map((r: { id: string }) => r.id)).toEqual([b, a])
    expect((await get(`${base()}/rules`)).json().rules.map((r: { id: string }) => r.id)).toEqual([
      b,
      a,
    ])
    expect((await order([a])).statusCode).toBe(400)
    expect((await order(['nope'])).statusCode).toBe(400)
    const asMember = await send('PUT', `${base()}/rules/order`, {
      cookie: louCookie,
      payload: { ruleIds: [a, b] },
    })
    expect(asMember.statusCode).toBe(403)
    const outsider = await send('PUT', `${base()}/rules/order`, {
      cookie: rivalCookie,
      payload: { ruleIds: [a, b] },
    })
    expect(outsider.statusCode).toBe(404)
    await send('DELETE', `${base()}/rules/${a}`)
    await send('DELETE', `${base()}/rules/${b}`)
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

  it('does not let a rival workspace reach the rule, or name its member', async () => {
    const mine = await send('POST', `${base()}/rules`, {
      payload: { kind: 'snapshot-name', pattern: 'y', reviewerIds: [lou.id] },
    })
    const foreign = await send('PUT', `${base(rival.workspaceSlug)}/rules/${mine.json().id}`, {
      cookie: rivalCookie,
      payload: { kind: 'snapshot-name', pattern: 'y', reviewerIds: [rival.owner.id] },
    })
    expect(foreign.statusCode).toBe(404)
    const outsider = await send('POST', `${base(rival.workspaceSlug)}/rules`, {
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
