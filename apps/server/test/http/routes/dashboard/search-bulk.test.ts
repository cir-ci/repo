import { afterAll, describe, expect, it } from 'vitest'

import { startDashboard } from '#test/support/dashboard-fixture.ts'
import { ORIGIN } from '#test/support/helpers.ts'

const fx = await startDashboard()
const { acme, rival, acmeCookie, rivalCookie, get, app, db } = fx
afterAll(() => fx.close())

// The fixture: Acme's `web` team has builds 1 (approved) and 2 (main, auto-approved), each
// with screenshots `home` and `about`. Rival has nothing.

const search = (workspace: string, q: string, cookie?: string) =>
  get(`/api/workspaces/${workspace}/search?q=${encodeURIComponent(q)}`, cookie)

const list = async (query: string): Promise<number[]> =>
  (await get(`/api/teams/${acme.workspaceSlug}/web${query}`))
    .json()
    .builds.map((b: { number: number }) => b.number)

const post = (payload: object, options: { workspace?: string; cookie?: string } = {}) =>
  app.inject({
    method: 'POST',
    url: `/api/teams/${options.workspace ?? acme.workspaceSlug}/web/builds/review`,
    headers: {
      'content-type': 'application/json',
      cookie: options.cookie ?? acmeCookie,
      origin: ORIGIN,
    },
    payload,
  })

async function numbersOf(): Promise<Record<number, string>> {
  const rows = await db.query.builds.findMany()
  return Object.fromEntries(
    rows.filter((b) => b.teamId === acme.team.id).map((b) => [b.number, b.reviewStatus]),
  )
}

describe('GET /api/workspaces/:workspace/search', () => {
  it('finds builds, branches, teams and snapshots', async () => {
    const byNumber = (await search(acme.workspaceSlug, '#2')).json()
    expect(byNumber.builds).toMatchObject([{ teamSlug: 'web', number: 2 }])
    const byName = (await search(acme.workspaceSlug, 'ab')).json()
    expect(byName.snapshots).toMatchObject([{ name: 'about', latestBuildNumber: 2 }])
    expect((await search(acme.workspaceSlug, 'mai')).json().branches).toMatchObject([
      { branch: 'main', latestBuildNumber: 2 },
    ])
    expect((await search(acme.workspaceSlug, 'we')).json().teams).toMatchObject([{ slug: 'web' }])
    expect((await search(acme.workspaceSlug, '')).json().builds).toEqual([])
  })

  it('is not found for a non-member, and rejects an over-long query', async () => {
    expect((await search(acme.workspaceSlug, 'web', rivalCookie)).statusCode).toBe(404)
    expect((await search(rival.workspaceSlug, 'web')).statusCode).toBe(404)
    expect((await search(acme.workspaceSlug, 'x'.repeat(101))).statusCode).toBe(400)
    expect((await search(acme.workspaceSlug, 'web', '')).statusCode).toBe(401)
  })
})

describe('GET /api/teams/:workspace/:team with filters', () => {
  it('keeps the unfiltered list and narrows by each filter', async () => {
    expect(await list('')).toEqual([2, 1])
    expect(await list('?review=pending')).toEqual([])
    expect(await list('?review=approved')).toEqual([2, 1])
    expect(await list('?status=complete&branch=main&name=default')).toEqual([2, 1])
    expect(await list('?branch=nope')).toEqual([])
    expect(await list('?from=2020-01-01T00:00:00.000Z&to=2020-02-01T00:00:00.000Z')).toEqual([])
    expect(await list('?author=nobody')).toEqual([])
    expect(await list(`?reviewer=${acme.owner.id}`)).toEqual([])
  })

  it('rejects unknown values', async () => {
    for (const q of ['?status=bogus', '?review=maybe', '?from=yesterday', '?branch=']) {
      // eslint-disable-next-line no-await-in-loop
      expect((await get(`/api/teams/${acme.workspaceSlug}/web${q}`)).statusCode).toBe(400)
    }
  })
})

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
  app.inject({
    method: 'POST',
    url: `/api/teams/${options.workspace ?? acme.workspaceSlug}/web/builds/request-review`,
    headers: {
      'content-type': 'application/json',
      cookie: options.cookie ?? acmeCookie,
      origin: ORIGIN,
    },
    payload,
  })
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
      (await ask({ buildIds: ids, reviewerIds: [acme.owner.id] }, { cookie: rivalCookie }))
        .statusCode,
    ).toBe(404)
    const missing = '00000000-0000-4000-8000-000000000000'
    expect(
      (await ask({ buildIds: [...ids, missing], reviewerIds: [acme.owner.id] })).statusCode,
    ).toBe(404)
    expect(await open()).toEqual([])
  })

  it('refuses all of it, not part, when a reviewer is outside the workspace', async () => {
    const rows = (await db.query.builds.findMany()).filter((b) => b.teamId === acme.team.id)
    const res = await ask({
      buildIds: rows.map((b) => b.id),
      reviewerIds: [acme.owner.id, rival.owner.id],
    })
    // Build 2 (auto-approved, no changes) cannot be asked either: a conflict, nothing stored.
    expect(res.statusCode).toBe(409)
    expect(await open()).toEqual([])
  })
})
