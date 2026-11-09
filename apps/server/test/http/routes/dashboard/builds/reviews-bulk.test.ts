import { afterAll, describe, expect, it } from 'vitest'

import { sender } from '#test/support/client.ts'
import { startDashboard } from '#test/support/dashboard-fixture.ts'

const fx = await startDashboard()
const { acme, rival, acmeCookie, rivalCookie, app, db } = fx
afterAll(() => fx.close())

// The fixture: Acme's `web` team has builds 1 (approved) and 2 (main, auto-approved), each
// with screenshots `home` and `about`. Rival has nothing.
const sendAs = sender(() => app, acmeCookie)
const post = (payload: object, options: { workspace?: string; cookie?: string } = {}) =>
  sendAs('POST', `/api/teams/${options.workspace ?? acme.workspaceSlug}/web/builds/review`, {
    payload,
    ...(options.cookie === undefined ? {} : { cookie: options.cookie }),
  })

async function numbersOf(): Promise<Record<number, string>> {
  const rows = await db.query.builds.findMany()
  return Object.fromEntries(
    rows.filter((b) => b.teamId === acme.team.id).map((b) => [b.number, b.reviewStatus]),
  )
}

describe('POST /api/teams/:workspace/:team/builds/review', () => {
  it('rejects the bad bodies with 400', async () => {
    const id = '00000000-0000-4000-8000-000000000000'
    expect((await post({ buildIds: [], decision: 'approved' })).statusCode).toBe(400)
    expect((await post({ buildIds: ['x'], decision: 'approved' })).statusCode).toBe(400)
    expect((await post({ buildIds: [id], decision: 'maybe' })).statusCode).toBe(400)
    expect(
      (await post({ buildIds: Array.from({ length: 51 }, () => id), decision: 'approved' }))
        .statusCode,
    ).toBe(400)
  })

  it('is not found for a non-member and for ids outside the team, changing nothing', async () => {
    const real = (await db.query.builds.findFirst({ where: (b, { eq }) => eq(b.number, 2) }))!
    expect(
      (await post({ buildIds: [real.id], decision: 'rejected' }, { cookie: rivalCookie }))
        .statusCode,
    ).toBe(404)
    const missing = '00000000-0000-4000-8000-000000000000'
    expect((await post({ buildIds: [real.id, missing], decision: 'rejected' })).statusCode).toBe(
      404,
    )
    expect(await numbersOf()).toEqual({ 1: 'approved', 2: 'approved' })
  })

  it('rejects several builds at once', async () => {
    const rows = (await db.query.builds.findMany()).filter((b) => b.teamId === acme.team.id)
    const res = await post({ buildIds: rows.map((b) => b.id), decision: 'rejected', reason: 'no' })
    expect(res.statusCode).toBe(200)
    expect(res.json().builds.map((b: { reviewStatus: string }) => b.reviewStatus)).toEqual([
      'rejected',
      'rejected',
    ])
    expect(await numbersOf()).toEqual({ 1: 'rejected', 2: 'rejected' })
  })
})

const ask = (payload: object, options: { workspace?: string; cookie?: string } = {}) =>
  sendAs(
    'POST',
    `/api/teams/${options.workspace ?? acme.workspaceSlug}/web/builds/request-review`,
    {
      payload,
      ...(options.cookie === undefined ? {} : { cookie: options.cookie }),
    },
  )
const open = async () =>
  (await db.query.reviewRequests.findMany()).filter((r) => r.state === 'open')

describe('POST /api/teams/:workspace/:team/builds/request-review', () => {
  it('rejects bad bodies with 400', async () => {
    const id = '00000000-0000-4000-8000-000000000000'
    expect((await ask({ buildIds: [], reviewerIds: ['u'] })).statusCode).toBe(400)
    expect((await ask({ buildIds: [id], reviewerIds: [] })).statusCode).toBe(400)
    expect((await ask({ buildIds: ['x'], reviewerIds: ['u'] })).statusCode).toBe(400)
    expect(
      (await ask({ buildIds: Array.from({ length: 51 }, () => id), reviewerIds: ['u'] }))
        .statusCode,
    ).toBe(400)
  })

  it('is not found for a non-member and for ids outside the team, changing nothing', async () => {
    const rows = (await db.query.builds.findMany()).filter((b) => b.teamId === acme.team.id)
    const ids = rows.map((b) => b.id)
    expect(
      (await ask({ buildIds: ids, reviewerIds: [rival.owner.id] }, { cookie: rivalCookie }))
        .statusCode,
    ).toBe(404)
    const missing = '00000000-0000-4000-8000-000000000000'
    expect(
      (await ask({ buildIds: [...ids, missing], reviewerIds: [rival.owner.id] })).statusCode,
    ).toBe(404)
    expect(await open()).toEqual([])
  })

  it('refuses all of it, not part, when a reviewer is outside the workspace', async () => {
    const rows = (await db.query.builds.findMany()).filter((b) => b.teamId === acme.team.id)
    const res = await ask({
      buildIds: rows.map((b) => b.id),
      reviewerIds: [rival.owner.id],
    })
    // Build 2 (auto-approved, no changes) cannot be asked either: a conflict, nothing stored.
    expect(res.statusCode).toBe(409)
    expect(await open()).toEqual([])
  })
})
