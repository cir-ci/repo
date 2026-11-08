import { afterAll, describe, expect, it } from 'vitest'

import { startDashboard } from '#test/support/dashboard-fixture.ts'

const fx = await startDashboard()
const { acme, rival, acmeCookie, rivalCookie, get } = fx
afterAll(() => fx.close())

// The fixture: Acme's `web` team has build 1 (approved by its owner) and build 2 (on main,
// approved automatically), each with screenshots `home` and `about`. Rival has nothing.

describe('GET /api/teams/:workspace/:team/baselines', () => {
  it('lists the default branch baselines with their source build', async () => {
    const res = await get(`/api/teams/${acme.workspaceSlug}/web/baselines`)
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.team).toMatchObject({ slug: 'web', defaultBranch: 'main' })
    expect(body.baselines).toMatchObject([
      { name: 'about', buildName: 'default', buildNumber: 2, width: 60, height: 40 },
      { name: 'home', buildName: 'default', buildNumber: 2, width: 60, height: 40 },
    ])
    expect(body.baselines[0].sizeBytes).toBeGreaterThan(0)
    expect(Date.parse(body.baselines[0].approvedAt)).not.toBeNaN()
  })

  it('is not found for a non-member, an unknown team, or without a session', async () => {
    expect(
      (await get(`/api/teams/${acme.workspaceSlug}/web/baselines`, rivalCookie)).statusCode,
    ).toBe(404)
    expect((await get(`/api/teams/${acme.workspaceSlug}/nope/baselines`)).statusCode).toBe(404)
    expect((await get(`/api/teams/${acme.workspaceSlug}/web/baselines`, '')).statusCode).toBe(401)
  })
})

const history = (name: string, query = '', cookie?: string) =>
  get(
    `/api/teams/${acme.workspaceSlug}/web/snapshots/${encodeURIComponent(name)}/history${query}`,
    cookie,
  )

describe('GET /api/teams/:workspace/:team/snapshots/:name/history', () => {
  it('lists the default branch builds with the snapshot image and status', async () => {
    const res = await history('home')
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.defaultBranch).toBe('main')
    expect(body.default.map((e: { build: { number: number } }) => e.build.number)).toEqual([2, 1])
    expect(body.default[0]).toMatchObject({
      build: { number: 2, branch: 'main', status: 'complete' },
      image: { width: 60, height: 40 },
    })
    expect(body.default[0].image.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(Date.parse(body.default[0].build.createdAt)).not.toBeNaN()
    expect(body.branch).toBeNull()
  })

  it('takes a limit and a branch, and handles slashes in names', async () => {
    const one = (await history('home', '?limit=1&branch=feature')).json()
    expect(one.default).toHaveLength(1)
    expect(one.branch).toEqual([])
    expect((await history('a/b/c')).json().default).toEqual([])
    // Anchored on build 1: the list starts there.
    expect(
      (await history('home', '?build=1'))
        .json()
        .default.map((e: { build: { number: number } }) => e.build.number),
    ).toEqual([1])
    expect((await history('home', '?build=0')).statusCode).toBe(400)
    expect((await history('home', '?limit=0')).statusCode).toBe(400)
    expect((await history('home', '?limit=21')).statusCode).toBe(400)
  })

  it('is not found for a non-member and needs a session', async () => {
    expect((await history('home', '', rivalCookie)).statusCode).toBe(404)
    expect((await history('home', '', '')).statusCode).toBe(401)
  })
})

const url = (workspace: string, query = '') => `/api/workspaces/${workspace}/insights${query}`

describe('GET /api/workspaces/:workspace/insights', () => {
  it('summarizes the last 30 days for a member', async () => {
    const res = await get(url(acme.workspaceSlug))
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.workspace.slug).toBe(acme.workspaceSlug)
    expect(body.team).toBeNull()
    // Build 1 had a person's decision just now; build 2 was approved automatically.
    expect(body.summary).toMatchObject({ buildsReviewed: 1, buildsFinished: 2 })
    expect(body.summary.medianReviewHours).toBeGreaterThanOrEqual(0)
    expect(body.storage.teams).toMatchObject([{ slug: 'web' }])
    expect(body.storage.totalBytes).toBeGreaterThan(0)
    expect(body.reviewers).toMatchObject([{ id: acme.owner.id, reviews: 1 }])
    expect(body.weeks.length).toBeGreaterThanOrEqual(5)
    expect(Date.parse(body.weeks[0].weekStart)).not.toBeNaN()
  })

  it('narrows to a team and a date range', async () => {
    const one = await get(url(acme.workspaceSlug, '?team=web'))
    expect(one.json().team).toBe('web')
    const old = await get(
      url(acme.workspaceSlug, '?from=2020-01-01T00:00:00.000Z&to=2020-02-01T00:00:00.000Z'),
    )
    expect(old.statusCode).toBe(200)
    expect(old.json().summary).toMatchObject({ buildsReviewed: 0, changeRate: null })
  })

  it('is not found for a non-member, an unknown workspace or team', async () => {
    expect((await get(url(acme.workspaceSlug), rivalCookie)).statusCode).toBe(404)
    expect((await get(url(rival.workspaceSlug), acmeCookie)).statusCode).toBe(404)
    expect((await get(url(acme.workspaceSlug, '?team=nope'))).statusCode).toBe(404)
    expect((await get(url(acme.workspaceSlug), '')).statusCode).toBe(401)
  })

  it('rejects a backwards or oversized range', async () => {
    const backwards = '?from=2026-02-01T00:00:00.000Z&to=2026-01-01T00:00:00.000Z'
    expect((await get(url(acme.workspaceSlug, backwards))).statusCode).toBe(400)
    const huge = '?from=2020-01-01T00:00:00.000Z&to=2026-01-01T00:00:00.000Z'
    expect((await get(url(acme.workspaceSlug, huge))).statusCode).toBe(400)
    expect((await get(url(acme.workspaceSlug, '?from=yesterday'))).statusCode).toBe(400)
  })
})
