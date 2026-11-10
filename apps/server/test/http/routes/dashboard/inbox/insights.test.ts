import { afterAll, describe, expect, it } from 'vitest'

import { startDashboard } from '#test/support/dashboard-fixture.ts'

const fx = await startDashboard()
const { acme, rival, acmeCookie, rivalCookie, get } = fx
afterAll(() => fx.close())

// The fixture: Acme's `web` team has build 1 (approved by its owner) and build 2 (on main,
// approved automatically), each with screenshots `home` and `about`. Rival has nothing.
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

  it('sends the new sections with their dates as ISO strings', async () => {
    const body = (await get(url(acme.workspaceSlug))).json()
    expect(body.bucket).toBe('week')
    expect(body.summary).toMatchObject({ failedBuilds: 0, buildsDecided: 1 })
    expect(body.summary.medianDecisionHours).toBeGreaterThanOrEqual(0)
    expect(body.weeks[0].outcomes).toEqual({
      approved: expect.any(Number),
      autoApproved: expect.any(Number),
      rejected: 0,
      failed: 0,
    })
    expect(body.storage.teams[0].colour).toEqual(expect.any(String))
    // Dates in lists are strings, and one team in the workspace means one comparison row.
    expect(Date.parse(body.backlog[0].day)).not.toBeNaN()
    expect(body.backlog.at(-1)).toMatchObject({ waiting: expect.any(Number) })
    expect(body.waitingNow).toBe(0)
    expect(body.oldestWaiting).toEqual([])
    expect(body.rejections).toEqual({ rejectedBuilds: 0, withReason: 0, recent: [] })
    expect(body.failureReasons).toEqual([])
    expect(body.mostRejected).toEqual([])
    expect(body.teamsComparison).toMatchObject([{ team: { slug: 'web' }, builds: 2 }])
    expect(body.ignoreRegions).toBeNull()
    expect(body.mostChanged).toBeInstanceOf(Array)
    expect(body.flakiest).toBeInstanceOf(Array)
  })

  it('has no comparison for one team, and a day axis for a week', async () => {
    const one = (await get(url(acme.workspaceSlug, '?team=web'))).json()
    expect(one.teamsComparison).toEqual([])
    const to = new Date(Date.now() + 3_600_000).toISOString()
    const from = new Date(Date.now() - 7 * 86_400_000 + 3_600_000).toISOString()
    const week = (await get(url(acme.workspaceSlug, `?from=${from}&to=${to}`))).json()
    expect(week.bucket).toBe('day')
    expect(week.weeks.length).toBeGreaterThanOrEqual(7)
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
