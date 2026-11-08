import { afterAll, describe, expect, it } from 'vitest'

import { png, startDashboard } from '../../../support/dashboard-fixture.ts'

const fx = await startDashboard()
const { acme, acmeCookie, rivalCookie, get, buildDetail, review, buildWith } = fx
afterAll(() => fx.close())

const reviewStatus = async () => (await buildDetail(acmeCookie)).json().build.reviewStatus

describe('reviewing a build', () => {
  it('starts approved on the default branch, and says it was automatic', async () => {
    expect(await reviewStatus()).toBe('approved')
    expect((await buildDetail(acmeCookie)).json().reviews).toEqual([
      { state: 'approved', source: 'auto', userName: null, createdAt: expect.any(String) },
    ])
  })

  it('lets a member reject, and then shows who did', async () => {
    const res = await review('rejected')
    expect(res.statusCode).toBe(200)
    expect(res.json().build).toMatchObject({ number: 2, reviewStatus: 'rejected' })

    const detail = (await buildDetail(acmeCookie)).json()
    expect(detail.build.reviewStatus).toBe('rejected')
    expect(detail.reviews[0]).toEqual({
      state: 'rejected',
      source: 'ui',
      userName: expect.stringMatching(/^Owner \d+$/),
      createdAt: expect.any(String),
    })
    expect((await get('/api/projects')).json().projects[0].latestBuild.reviewStatus).toBe(
      'rejected',
    )
  })

  it('lets them change their mind, keeping the history', async () => {
    expect((await review('approved')).json().build.reviewStatus).toBe('approved')
    expect(
      (await buildDetail(acmeCookie))
        .json()
        .reviews.map((r: { state: string; source: string }) => [r.state, r.source]),
    ).toEqual([
      ['approved', 'ui'],
      ['rejected', 'ui'],
      ['approved', 'auto'],
    ])
  })

  it('needs a session', async () => {
    expect((await review('rejected', { cookie: '' })).statusCode).toBe(401)
    expect(await reviewStatus()).toBe('approved')
  })

  it('keeps other organizations out, with the same answer as for a missing build', async () => {
    const theirs = await review('rejected', { cookie: rivalCookie })
    const missing = await review('rejected', { cookie: rivalCookie, build: 99 })
    expect([theirs.statusCode, missing.statusCode]).toEqual([404, 404])
    expect(theirs.json()).toEqual(missing.json())
    expect(await reviewStatus()).toBe('approved')
  })

  it('refuses a request from another site, even with the right cookie', async () => {
    const fromEvilSite = await review('rejected', { origin: 'https://sb.example-sites.com' })
    expect(fromEvilSite.statusCode).toBe(403)
    const crossSiteNoOrigin = await review('rejected', {
      origin: null,
      headers: { 'sec-fetch-site': 'cross-site' },
    })
    expect(crossSiteNoOrigin.statusCode).toBe(403)
    expect(await reviewStatus()).toBe('approved')
  })

  it('accepts a request that carries no browser headers at all (curl, scripts)', async () => {
    expect((await review('approved', { origin: null })).statusCode).toBe(200)
  })

  it('rejects anything but approved or rejected', async () => {
    for (const state of ['pending', 'maybe', 5, undefined]) {
      // oxlint-disable-next-line no-await-in-loop -- tiny fixed list
      expect((await review(state)).statusCode).toBe(400)
    }
  })

  it('refuses a build with no changes to decide on', async () => {
    // Same screenshots as build 1 (approved), so build 3 matches its baseline exactly.
    await buildWith(acme.project.id, 'aaaa003', ['aaaa001'], {
      home: await png('#ffffff'),
      about: await png('#eeeeee'),
    })
    const res = await review('approved', { build: 3 })
    expect(res.statusCode).toBe(409)
    expect(res.json().error).toMatch(/no changes to review/)
  })
})
