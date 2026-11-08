import { afterAll, describe, expect, it } from 'vitest'

import { png, startDashboard } from '#test/support/dashboard-fixture.ts'

const fx = await startDashboard()
const { acme, acmeCookie, rivalCookie, get, buildDetail, review, buildWith } = fx
afterAll(() => fx.close())

const reviewStatus = async () => (await buildDetail(acmeCookie)).json().build.reviewStatus

describe('reviewing a build', () => {
  it('starts approved on the default branch once there is a baseline, and says it was automatic', async () => {
    // The fixture approved build 1 by hand (a first build is never automatic); build 2 compares
    // with it and is approved without anyone looking.
    const first = (await get(`/api/teams/${acme.workspaceSlug}/web/builds/1`)).json()
    expect(first.reviews).toMatchObject([{ state: 'approved', source: 'ui' }])
    expect((await buildDetail(acmeCookie)).json().baseline).toMatchObject({ number: 1 })
    expect(await reviewStatus()).toBe('approved')
    expect((await buildDetail(acmeCookie)).json().reviews).toEqual([
      {
        state: 'approved',
        source: 'auto',
        reason: null,
        userName: null,
        createdAt: expect.any(String),
      },
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
      reason: null,
      userName: expect.stringMatching(/^Owner \d+$/),
      createdAt: expect.any(String),
    })
    expect((await get('/api/teams')).json().teams[0].latestBuild.reviewStatus).toBe('rejected')
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

  it('keeps other workspaces out, with the same answer as for a missing build', async () => {
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
    await buildWith(acme.team.id, 'aaaa003', ['aaaa001'], {
      home: await png('#ffffff'),
      about: await png('#eeeeee'),
    })
    const res = await review('approved', { build: 3 })
    expect(res.statusCode).toBe(409)
    expect(res.json().error).toMatch(/no changes to review/)
  })
})

const decide = (
  payload: object,
  options: { cookie?: string; workspace?: string; build?: number } = {},
) =>
  fx.app.inject({
    method: 'POST',
    url: `/api/teams/${options.workspace ?? acme.workspaceSlug}/web/builds/${options.build ?? 2}/snapshots/review`,
    headers: {
      'content-type': 'application/json',
      cookie: options.cookie ?? acmeCookie,
    },
    payload,
  })
const homeReview = async () =>
  (await buildDetail(acmeCookie)).json().diffs.find((d: { name: string }) => d.name === 'home')
    .review

describe('reviewing snapshots', () => {
  it('decides one snapshot, shows who and why, and derives the build status', async () => {
    const rejected = await decide({
      snapshotNames: ['home'],
      decision: 'rejected',
      reason: 'wrong red',
    })
    expect(rejected.statusCode).toBe(200)
    expect(rejected.json().build).toMatchObject({ number: 2, reviewStatus: 'rejected' })
    expect(await homeReview()).toMatchObject({
      decision: 'rejected',
      reason: 'wrong red',
      reviewer: { name: expect.stringMatching(/^Owner \d+$/) },
      at: expect.any(String),
    })

    const approved = await decide({ snapshotNames: ['home'], decision: 'approved' })
    expect(approved.json().build.reviewStatus).toBe('approved')
    expect(await homeReview()).toMatchObject({ decision: 'approved', reason: null })
  })

  it('answers a stranger like a missing build, and refuses a snapshot that did not change', async () => {
    const body = { snapshotNames: ['home'], decision: 'rejected' }
    const theirs = await decide(body, { cookie: rivalCookie })
    const missing = await decide(body, { cookie: rivalCookie, build: 99 })
    expect([theirs.statusCode, missing.statusCode]).toEqual([404, 404])
    expect(await homeReview()).toMatchObject({ decision: 'approved' })

    const unchanged = await decide({ snapshotNames: ['about'], decision: 'approved' })
    expect(unchanged.statusCode).toBe(409)
    expect((await decide({ snapshotNames: [], decision: 'approved' })).statusCode).toBe(400)
  })
})
