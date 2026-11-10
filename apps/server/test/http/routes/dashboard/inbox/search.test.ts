import { createTeam } from '@circi/db/repositories'
import * as schema from '@circi/db/schema'
import {
  seedBuild,
  seedNotification,
  seedReviewRequest,
  seedSavedView,
  seedScreenshot,
} from '@circi/db/testing'
import { fakeSha } from '@circi/testing'
import { eq } from 'drizzle-orm'
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

describe('GET /api/workspaces/:workspace/search, the other groups', () => {
  it('answers every group, empty ones as lists', async () => {
    const found = (await search(acme.workspaceSlug, 'zzzz')).json()
    for (const group of [
      'builds',
      'branches',
      'teams',
      'snapshots',
      'baselines',
      'triage',
      'notifications',
      'reviews',
      'views',
    ]) {
      expect(found[group]).toEqual([])
    }
  })

  it('finds a baseline by a path segment of its screenshot name', async () => {
    const found = (await search(acme.workspaceSlug, 'hom')).json()
    expect(found.baselines).toMatchObject([{ teamSlug: 'web', name: 'home', buildNumber: 2 }])
  })

  it("finds the person's own notifications, review requests and views, as ISO dates", async () => {
    const build = await fx.db.query.builds.findFirst({ where: eq(schema.builds.number, 2) })
    if (!build) throw new Error('fixture build missing')
    const note = await seedNotification(fx.db, {
      userId: acme.owner.id,
      buildId: build.id,
      kind: 'mentioned',
      payload: { snippet: 'looks like a regression in the header' },
    })
    await seedReviewRequest(fx.db, { buildId: build.id, reviewerId: acme.owner.id })
    await seedSavedView(fx.db, {
      userId: acme.owner.id,
      workspaceId: acme.team.workspaceId,
      name: 'Header regressions',
    })
    const found = (await search(acme.workspaceSlug, 'header')).json()
    expect(found.notifications).toMatchObject([
      { id: note.id, kind: 'mentioned', tab: 'everything', read: false },
    ])
    expect(typeof found.notifications[0].createdAt).toBe('string')
    expect(found.views).toMatchObject([{ name: 'Header regressions', team: null }])
    expect((await search(acme.workspaceSlug, 'web')).json().reviews).toMatchObject([
      { tab: 'for-you', teamSlug: 'web' },
    ])
    // Another person in the workspace sees none of them.
    expect(
      (await get(`/api/workspaces/${rival.workspaceSlug}/search?q=header`, rivalCookie)).json(),
    ).toMatchObject({ notifications: [], views: [] })
  })

  it('never shows a team the person cannot see, in any group', async () => {
    const member = await fx.addMember('member')
    const hidden = await createTeam(fx.db, { workspaceSlug: acme.workspaceSlug, name: 'hush' })
    const b = await seedBuild(fx.db, hidden.id, {
      branch: 'main',
      status: 'complete',
      conclusion: 'no_changes',
      reviewStatus: 'approved',
      name: 'hush-build',
    })
    await seedScreenshot(fx.db, { buildId: b.id, name: 'hush/page', fileSha256: fakeSha('e') })
    await seedBuild(fx.db, hidden.id, { branch: 'main', status: 'error' })
    for (const q of ['hush', 'hush/page', 'failed']) {
      // eslint-disable-next-line no-await-in-loop -- reads
      const body = (await member.get(`/api/workspaces/${acme.workspaceSlug}/search?q=${q}`)).json()
      expect(JSON.stringify({ ...body, query: '' })).not.toMatch(/hush/)
      expect(body.triage.map((i: { teamSlug: string }) => i.teamSlug)).not.toContain('hush')
    }
    const owner = (await search(acme.workspaceSlug, 'hush')).json()
    expect(owner.teams).toMatchObject([{ slug: 'hush' }])
    expect((await search(acme.workspaceSlug, 'hush/page')).json().baselines).toMatchObject([
      { teamSlug: 'hush' },
    ])
  })
})

describe('GET /api/workspaces/:workspace/search, team, kinds, limit and totals', () => {
  const ws = acme.workspaceSlug
  const emptyTotals = {
    builds: 0,
    branches: 0,
    teams: 0,
    snapshots: 0,
    baselines: 0,
    triage: 0,
    notifications: 0,
    reviews: 0,
    views: 0,
  }

  it('counts every match per kind, though a group holds only `limit` of them', async () => {
    const all = (await search(ws, 'o')).json()
    expect(all.totals.snapshots).toBe(2)
    const one = (await get(`/api/workspaces/${ws}/search?q=o&limit=1`)).json()
    expect(one.snapshots).toHaveLength(1)
    expect(one.totals.snapshots).toBe(2)
    expect((await search(ws, '')).json().totals).toEqual(emptyTotals)
  })

  it('answers only the kinds asked for, the others empty with a total of 0', async () => {
    const found = (await get(`/api/workspaces/${ws}/search?q=web&kinds=teams,builds`)).json()
    expect(found.teams).toMatchObject([{ slug: 'web' }])
    expect(found.totals.teams).toBe(1)
    const onlyShots = (await get(`/api/workspaces/${ws}/search?q=hom&kinds=snapshots`)).json()
    expect(onlyShots.snapshots).toMatchObject([{ name: 'home' }])
    expect(onlyShots.baselines).toEqual([])
    expect(onlyShots.totals).toEqual({ ...emptyTotals, snapshots: 1 })
  })

  it('keeps to one team, and a hidden team stays hidden when asked for by name', async () => {
    const inWeb = (await get(`/api/workspaces/${ws}/search?q=hush&team=web`)).json()
    expect(inWeb.teams).toEqual([])
    const inHush = (await get(`/api/workspaces/${ws}/search?q=hush&team=hush`)).json()
    expect(inHush.teams).toMatchObject([{ slug: 'hush' }])
    expect(inHush.totals.teams).toBe(1)
    const homeInHush = (await get(`/api/workspaces/${ws}/search?q=home&team=hush`)).json()
    expect(homeInHush.snapshots).toEqual([])
    const homeInWeb = (await get(`/api/workspaces/${ws}/search?q=home&team=web`)).json()
    expect(homeInWeb.snapshots).toMatchObject([{ teamSlug: 'web' }])
    // A member who isn't in a team (added first: a team made later is not theirs) finds nothing in it.
    const member = await fx.addMember('member')
    await createTeam(fx.db, { workspaceSlug: ws, name: 'quiet' })
    const asMember = (await member.get(`/api/workspaces/${ws}/search?q=quiet&team=quiet`)).json()
    expect(asMember.teams).toEqual([])
    expect(asMember.totals).toEqual(emptyTotals)
    const asOwner = (await get(`/api/workspaces/${ws}/search?q=quiet&team=quiet`)).json()
    expect(asOwner.teams).toMatchObject([{ slug: 'quiet' }])
  })

  it('rejects an unknown kind and a limit out of range', async () => {
    for (const q of ['kinds=bogus', 'limit=0', 'limit=51', 'limit=x']) {
      // eslint-disable-next-line no-await-in-loop -- reads
      expect((await get(`/api/workspaces/${ws}/search?q=web&${q}`)).statusCode).toBe(400)
    }
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
    // Free text: a build number, commit prefix, branch, name or author.
    expect(await list('?q=2')).toEqual([2])
    expect(await list('?q=aaaa00')).toEqual([2, 1])
    expect(await list('?q=MAI')).toEqual([2, 1])
    expect(await list('?q=nothing-like-it')).toEqual([])
    // The open review request the search tests above made for build 2.
    expect(await list(`?reviewer=${acme.owner.id}`)).toEqual([2])
  })

  it('rejects unknown values', async () => {
    for (const q of ['?status=bogus', '?review=maybe', '?from=yesterday', '?branch=', '?q=']) {
      // eslint-disable-next-line no-await-in-loop
      expect((await get(`/api/teams/${acme.workspaceSlug}/web${q}`)).statusCode).toBe(400)
    }
  })
})
