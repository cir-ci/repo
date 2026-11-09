import { afterAll, describe, expect, it } from 'vitest'

import { startDashboard } from '#test/support/dashboard-fixture.ts'

const fx = await startDashboard()
const { acme, rival, rivalCookie, get } = fx
afterAll(() => fx.close())

// The fixture: Acme's `web` team has builds 1 (approved) and 2 (main, auto-approved), each
// with screenshots `home` and `about`. Rival has nothing.

const search = (workspace: string, q: string, cookie?: string) =>
  get(`/api/workspaces/${workspace}/search?q=${encodeURIComponent(q)}`, cookie)

const list = async (query: string): Promise<number[]> =>
  (await get(`/api/teams/${acme.workspaceSlug}/web${query}`))
    .json()
    .builds.map((b: { number: number }) => b.number)

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
