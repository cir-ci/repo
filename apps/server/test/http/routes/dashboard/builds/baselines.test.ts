import { afterAll, describe, expect, it } from 'vitest'

import { startDashboard } from '#test/support/dashboard-fixture.ts'

const fx = await startDashboard()
const { acme, rivalCookie, get } = fx
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
    // Approved automatically on main: nobody to name.
    expect(body.baselines[0].approvedBy).toBeNull()
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
