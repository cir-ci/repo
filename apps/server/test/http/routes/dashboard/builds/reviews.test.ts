import * as schema from '@circi/db/schema'
import { seedGitLink } from '@circi/db/testing'
import { eq } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

import { png, startDashboard } from '#test/support/dashboard-fixture.ts'

const fx = await startDashboard()
const { acme, acmeCookie, rivalCookie, get, buildDetail, review, buildWith } = fx
afterAll(() => fx.close())

const reviewStatus = async () => (await buildDetail(acmeCookie)).json().build.reviewStatus

const reset = await fx.snapshot()
beforeEach(reset)

describe('reviewing a build', () => {
  it('starts approved on the default branch once there is a baseline, and says it was automatic', async () => {
    // The fixture approved build 1 by hand (a first build is never automatic); build 2 compares
    // with it and is approved without anyone looking.
    const first = (await get(`/api/projects/${acme.workspaceSlug}/web/builds/1`)).json()
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
    expect((await get('/api/projects')).json().projects[0].latestBuild.reviewStatus).toBe(
      'rejected',
    )
  })

  it('lets them change their mind, keeping the history', async () => {
    expect((await review('rejected')).statusCode).toBe(200)
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
    await buildWith(acme.project.id, 'aaaa003', ['aaaa001'], {
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
    url: `/api/projects/${options.workspace ?? acme.workspaceSlug}/web/builds/${options.build ?? 2}/snapshots/review`,
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

const notices = async () =>
  (await fx.db.select().from(schema.jobs).where(eq(schema.jobs.queue, 'git-notify')))
    .filter((j) => j.status === 'pending')
    .map((j) => j.dedupeKey ?? '')

/** The pull request comment is rewritten from a `git-notify` job; each review move queues one. */
describe('refreshing the pull request comment', () => {
  it('queues a git-notify for an approval or rejection from the dashboard, and for a single snapshot', async () => {
    await seedGitLink(fx.db, acme.project.id, { externalId: '99', repoRef: 'acme/web' })
    await fx.db.delete(schema.jobs)
    expect((await review('rejected')).statusCode).toBe(200)
    expect((await notices()).some((k) => k.endsWith(':rejected'))).toBe(true)
    expect((await review('approved')).statusCode).toBe(200)
    expect((await notices()).some((k) => k.endsWith(':approved'))).toBe(true)

    // Deciding one snapshot moves the build too (a rejection of `home` rejects the build).
    await fx.db.delete(schema.jobs)
    expect((await decide({ snapshotNames: ['home'], decision: 'rejected' })).statusCode).toBe(200)
    expect((await notices()).some((k) => k.endsWith(':rejected'))).toBe(true)
  })
})

/** What the build page's Details tab shows beside the status: the review target, who is notified, the PR. */
const facts = async () => (await buildDetail(acmeCookie)).json()

describe('the build page facts', () => {
  it('has a target but no due time while nobody is asked, and nobody to notify but the author', async () => {
    const detail = await facts()
    expect(detail.reviewTarget).toEqual({ hours: 24, dueAt: null })
    expect(detail.watchers).toEqual([])
    expect(detail.pullRequest).toBeNull()
  })

  it('counts down from the soonest open request, and lists the people asked as watchers', async () => {
    const [build] = await fx.db.select().from(schema.builds).where(eq(schema.builds.number, 2))
    if (!build) throw new Error('build 2 is missing')
    const other = (await fx.db.select().from(schema.user)).find((u) => u.id !== acme.owner.id)
    if (!other) throw new Error('no second user')
    const later = new Date(Date.now() + 7_200_000)
    await fx.db.insert(schema.reviewRequests).values([
      { buildId: build.id, reviewerId: acme.owner.id, reviewerName: 'Owner', dueAt: later },
      // A snoozed request is not counted down.
      {
        buildId: build.id,
        reviewerId: other.id,
        reviewerName: other.name,
        dueAt: new Date(Date.now() - 1000),
        snoozeKind: 'next_push',
      },
    ])
    const detail = await facts()
    expect(detail.reviewTarget.dueAt).toBe(later.toISOString())
    expect(detail.watchers.map((w: { id: string }) => w.id).toSorted()).toEqual(
      [acme.owner.id, other.id].toSorted(),
    )
  })

  it('names the repository next to the pull request number', async () => {
    await seedGitLink(fx.db, acme.project.id, { externalId: '99', repoRef: 'acme/web' })
    await fx.db.update(schema.builds).set({ prNumber: 412 }).where(eq(schema.builds.number, 2))
    expect((await facts()).pullRequest).toEqual({ number: 412, repo: 'acme/web' })
  })
})
