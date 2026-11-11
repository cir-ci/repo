import { seedNotification } from '@circi/db/testing'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

import { startDashboard } from '#test/support/dashboard-fixture.ts'

const fx = await startDashboard()
const { acme, acmeCookie, db, client, review, buildDetail } = fx
afterAll(() => fx.close())

const reset = await fx.snapshot()
beforeEach(reset)

const project = `/api/projects/${acme.workspaceSlug}/web`
const reviewStatus = async () => (await buildDetail(acmeCookie)).json().build.reviewStatus

describe('POST …/undo/:id', () => {
  it('takes back a decision the answer gave a token for, once', async () => {
    const res = await review('rejected')
    const { undo } = res.json()
    expect(undo).toEqual({ id: expect.any(String), expiresAt: expect.any(String) })
    expect(await reviewStatus()).toBe('rejected')

    const undone = await client.send('POST', `${project}/undo/${undo.id}`)
    expect(undone.statusCode).toBe(200)
    expect(undone.json()).toEqual({ undone: true })
    expect(await reviewStatus()).toBe('approved')

    const again = await client.send('POST', `${project}/undo/${undo.id}`)
    expect(again.statusCode).toBe(409)
    expect(again.json().error).toBe('Already undone')
  })

  it('answers 403 to another member, and 409 once something newer decided the same screenshots', async () => {
    const other = await fx.addMember('member')
    const { undo } = (await review('rejected')).json()
    const forbidden = await other.send('POST', `${project}/undo/${undo.id}`)
    expect(forbidden.statusCode).toBe(403)
    expect(await reviewStatus()).toBe('rejected')

    await other.send('POST', `${project}/builds/2/review`, { state: 'approved' })
    const stale = await client.send('POST', `${project}/undo/${undo.id}`)
    expect(stale.statusCode).toBe(409)
    expect(stale.json().error).toContain('Someone changed this review')
    expect(await reviewStatus()).toBe('approved')
  })

  it('keeps outsiders and other scopes out', async () => {
    const outsider = await fx.addMember('outsider')
    const { undo } = (await review('rejected')).json()
    expect((await outsider.send('POST', `${project}/undo/${undo.id}`)).statusCode).toBe(404)
    // The inbox's route is for the inbox's tokens only.
    expect((await client.send('POST', `/api/inbox/undo/${undo.id}`)).statusCode).toBe(404)
    expect((await client.send('POST', `${project}/undo/not-an-id`)).statusCode).toBe(400)
  })

  it('takes back a removed notice through the inbox route', async () => {
    const n = await seedNotification(db, { userId: acme.owner.id, kind: 'mentioned' })
    const removed = await client.send('DELETE', `/api/inbox/${n.id}`)
    expect(removed.statusCode).toBe(200)
    const { undo } = removed.json()
    expect((await client.send('POST', `/api/inbox/undo/${undo.id}`)).statusCode).toBe(200)
    const list = (await client.get('/api/inbox?tab=everything')).json()
    expect(list.items.map((i: { id: string }) => i.id)).toContain(n.id)
  })

  it('takes back a triage dismissal', async () => {
    const dismissed = await client.send('POST', `${project}/triage/dismiss`, {
      kind: 'flaky',
      key: 'checkout',
    })
    expect(dismissed.json()).toMatchObject({ dismissed: true, undo: { id: expect.any(String) } })
    const undone = await client.send('POST', `${project}/undo/${dismissed.json().undo.id}`)
    expect(undone.statusCode).toBe(200)
    const again = await client.send('POST', `${project}/triage/dismiss`, {
      kind: 'flaky',
      key: 'checkout',
    })
    expect(again.json().undo).not.toBeNull()
  })
})
