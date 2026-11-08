import { afterAll, describe, expect, it } from 'vitest'

import { startDashboard } from '../../../support/dashboard-fixture.ts'

const fx = await startDashboard()
const { acme, rival, acmeCookie, rivalCookie, get } = fx
afterAll(() => fx.close())

// The fixture: Acme's `web` project has build 1 (approved by its owner) and build 2 (on main,
// approved automatically), each with screenshots `home` and `about`. Rival has nothing.

describe('GET /api/projects/:org/:project/baselines', () => {
  it('lists the default branch baselines with their source build', async () => {
    const res = await get(`/api/projects/${acme.orgSlug}/web/baselines`)
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.project).toMatchObject({ slug: 'web', defaultBranch: 'main' })
    expect(body.baselines).toMatchObject([
      { name: 'about', buildName: 'default', buildNumber: 2, width: 60, height: 40 },
      { name: 'home', buildName: 'default', buildNumber: 2, width: 60, height: 40 },
    ])
    expect(body.baselines[0].sizeBytes).toBeGreaterThan(0)
    expect(Date.parse(body.baselines[0].approvedAt)).not.toBeNaN()
  })

  it('is not found for a non-member, an unknown project, or without a session', async () => {
    expect((await get(`/api/projects/${acme.orgSlug}/web/baselines`, rivalCookie)).statusCode).toBe(
      404,
    )
    expect((await get(`/api/projects/${acme.orgSlug}/nope/baselines`)).statusCode).toBe(404)
    expect((await get(`/api/projects/${acme.orgSlug}/web/baselines`, '')).statusCode).toBe(401)
  })
})

const url = (org: string, query = '') => `/api/orgs/${org}/insights${query}`

describe('GET /api/orgs/:org/insights', () => {
  it('summarizes the last 30 days for a member', async () => {
    const res = await get(url(acme.orgSlug))
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.org.slug).toBe(acme.orgSlug)
    expect(body.project).toBeNull()
    // Build 1 had a person's decision just now; build 2 was approved automatically.
    expect(body.summary).toMatchObject({ buildsReviewed: 1, buildsFinished: 2 })
    expect(body.summary.medianReviewHours).toBeGreaterThanOrEqual(0)
    expect(body.storage.projects).toMatchObject([{ slug: 'web' }])
    expect(body.storage.totalBytes).toBeGreaterThan(0)
    expect(body.reviewers).toMatchObject([{ id: acme.owner.id, reviews: 1 }])
    expect(body.weeks.length).toBeGreaterThanOrEqual(5)
    expect(Date.parse(body.weeks[0].weekStart)).not.toBeNaN()
  })

  it('narrows to a project and a date range', async () => {
    const one = await get(url(acme.orgSlug, '?project=web'))
    expect(one.json().project).toBe('web')
    const old = await get(
      url(acme.orgSlug, '?from=2020-01-01T00:00:00.000Z&to=2020-02-01T00:00:00.000Z'),
    )
    expect(old.statusCode).toBe(200)
    expect(old.json().summary).toMatchObject({ buildsReviewed: 0, changeRate: null })
  })

  it('is not found for a non-member, an unknown organization or project', async () => {
    expect((await get(url(acme.orgSlug), rivalCookie)).statusCode).toBe(404)
    expect((await get(url(rival.orgSlug), acmeCookie)).statusCode).toBe(404)
    expect((await get(url(acme.orgSlug, '?project=nope'))).statusCode).toBe(404)
    expect((await get(url(acme.orgSlug), '')).statusCode).toBe(401)
  })

  it('rejects a backwards or oversized range', async () => {
    const backwards = '?from=2026-02-01T00:00:00.000Z&to=2026-01-01T00:00:00.000Z'
    expect((await get(url(acme.orgSlug, backwards))).statusCode).toBe(400)
    const huge = '?from=2020-01-01T00:00:00.000Z&to=2026-01-01T00:00:00.000Z'
    expect((await get(url(acme.orgSlug, huge))).statusCode).toBe(400)
    expect((await get(url(acme.orgSlug, '?from=yesterday'))).statusCode).toBe(400)
  })
})
