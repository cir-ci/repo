import {
  addTestMember,
  createTestDb,
  seedBuild,
  seedDiff,
  seedTeam,
  seedReview,
  seedReviewRequest,
  seedScreenshot,
  seedUser,
} from '@circi/db/testing'
import { fakeSha } from '@circi/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { getInsights } from '#src/queries/index.ts'
import { createTeam } from '#src/repositories/index.ts'

let t: createTestDb.Result
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(async () => {
  await t.close()
})

const at = (iso: string) => new Date(`2026-${iso}:00Z`)

/**
 * The history (UTC), for team `web` (default branch main, 24h review target) in an
 * workspace with members Owner (O) and Mia (M). The range is Mon 9 March to Mon 23 March,
 * so the previous stretch is 23 February to 9 March.
 *
 *  Feature builds, all with changes (ready = finished; first decision in brackets):
 *   f1 ready 03-09 10:00   O approves 03-09 12:00 (2h)
 *   f2 ready 03-10 08:00   M approves 03-10 20:00 (12h)
 *   f3 ready 03-17 09:00   O approves 03-18 15:00 (30h, over target); M also decides 03-19 09:00
 *   f4 ready 03-18 10:00   never reviewed
 *  Main builds (auto-approved, not reviewed by anyone):
 *   m1 03-10 12:00 changes (hero, nav changed)   m2 03-11 12:00 changes (hero)
 *   m3 03-18 12:00 changes (hero)                m4 03-19 12:00 no changes
 *  Before the range: p1 feature 03-02 10:00 changes, O approves 03-02 16:00 (6h);
 *   p2 main 03-03 10:00 no changes.
 *
 *  Requests: f4 to O (created 03-18 10:00, due 03-19 10:00, open); f3 to M (03-17 10:00, due
 *   03-18 10:00, done 03-19 10:00); f2 to M (03-10 08:00, due 03-11 08:00, done 03-10 20:00).
 *  Files: f1 has "home" (1000 bytes) with a 100 byte thumbnail; f3 has the same "home" file; f2 has
 *   a 50 byte diff image. A second team `docs` holds the same home file (1000 bytes).
 */
async function history() {
  const { team, workspace, owner } = await seedTeam(t.db, { slug: 'web' })
  const docs = await createTeam(t.db, { workspaceSlug: workspace.slug, name: 'docs' })
  const mia = await seedUser(t.db)
  await addTestMember(t.db, { workspaceId: workspace.id, userId: mia.id })

  const make = (
    branch: string,
    ready: string,
    conclusion: 'changes_detected' | 'no_changes' = 'changes_detected',
  ) =>
    seedBuild(t.db, team.id, {
      branch,
      status: 'complete',
      conclusion,
      createdAt: at(ready),
      completedAt: at(ready),
    })
  const f1 = await make('feature/a', '03-09T10:00')
  const f2 = await make('feature/b', '03-10T08:00')
  const f3 = await make('feature/c', '03-17T09:00')
  const f4 = await make('feature/d', '03-18T10:00')
  const m1 = await make('main', '03-10T12:00')
  const m2 = await make('main', '03-11T12:00')
  const m3 = await make('main', '03-18T12:00')
  await make('main', '03-19T12:00', 'no_changes')
  const p1 = await make('feature/p', '03-02T10:00')
  await make('main', '03-03T10:00', 'no_changes')

  const decide = (buildId: string, userId: string | null, when: string) =>
    seedReview(t.db, { buildId, userId, createdAt: at(when) })
  await decide(f1.id, owner.id, '03-09T12:00')
  await decide(f2.id, mia.id, '03-10T20:00')
  await decide(f3.id, owner.id, '03-18T15:00')
  await decide(f3.id, mia.id, '03-19T09:00')
  await decide(p1.id, owner.id, '03-02T16:00')
  await decide(m1.id, null, '03-10T12:00')
  await decide(m2.id, null, '03-11T12:00')
  await decide(m3.id, null, '03-18T12:00')

  await seedDiff(t.db, { buildId: m1.id, name: 'hero', status: 'changed' })
  await seedDiff(t.db, { buildId: m1.id, name: 'nav', status: 'changed' })
  await seedDiff(t.db, { buildId: m2.id, name: 'hero', status: 'changed' })
  await seedDiff(t.db, { buildId: m3.id, name: 'hero', status: 'changed' })

  await seedReviewRequest(t.db, {
    buildId: f4.id,
    reviewerId: owner.id,
    dueAt: at('03-19T10:00'),
    createdAt: at('03-18T10:00'),
  })
  const done = async (buildId: string, created: string, due: string, closed: string) => {
    const r = await seedReviewRequest(t.db, {
      buildId,
      reviewerId: mia.id,
      state: 'done',
      dueAt: at(due),
      createdAt: at(created),
    })
    await t.db.execute(
      `update review_requests set closed_at = '2026-${closed}:00Z' where id = '${r.id}'`,
    )
  }
  await done(f3.id, '03-17T10:00', '03-18T10:00', '03-19T10:00')
  await done(f2.id, '03-10T08:00', '03-11T08:00', '03-10T20:00')

  await seedScreenshot(t.db, {
    buildId: f1.id,
    name: 'home',
    fileSha256: fakeSha('a'),
    size: 1000,
    thumbnailSha256: fakeSha('b'),
    thumbnailSize: 100,
  })
  await seedScreenshot(t.db, { buildId: f3.id, name: 'home', fileSha256: fakeSha('a'), size: 1000 })
  await seedDiff(t.db, {
    buildId: f2.id,
    name: 'home',
    diffFileSha256: fakeSha('c'),
    diffFileSize: 50,
  })
  const docsBuild = await seedBuild(t.db, docs.id, { status: 'complete' })
  await seedScreenshot(t.db, {
    buildId: docsBuild.id,
    name: 'home',
    fileSha256: fakeSha('a'),
    size: 1000,
  })
  return { workspace, owner, mia }
}

const range = { from: at('03-09T00:00'), to: at('03-23T00:00'), now: at('03-20T00:00') }

describe('getInsights', () => {
  it('answers the headline numbers for the range and the stretch before it', async () => {
    const { workspace, owner } = await history()
    const r = await getInsights(t.db, { userId: owner.id, workspaceSlug: workspace.slug, ...range })
    expect(r?.summary).toEqual({
      // waits of 2h, 12h and 30h; p90 interpolates 12 + 0.8 * (30 - 12)
      medianReviewHours: 12,
      p90ReviewHours: 26.4,
      buildsReviewed: 3,
      reviewedOverTarget: 1,
      // 8 finished builds in range (f1-f4, m1-m4), 7 with changes
      buildsFinished: 8,
      buildsWithChanges: 7,
      changeRate: 7 / 8,
    })
    expect(r?.previous).toEqual({
      medianReviewHours: 6,
      p90ReviewHours: 6,
      buildsReviewed: 1,
      reviewedOverTarget: 0,
      buildsFinished: 2,
      buildsWithChanges: 1,
      changeRate: 0.5,
    })
  })

  it('buckets review time and flaky screenshots by week', async () => {
    const { workspace, owner } = await history()
    const r = await getInsights(t.db, { userId: owner.id, workspaceSlug: workspace.slug, ...range })
    expect(
      r?.weeks.map((w) => [
        w.weekStart.toISOString().slice(0, 10),
        w.reviews,
        w.medianReviewHours,
        w.flaky,
      ]),
    ).toEqual([
      // hero changed twice by the end of week one: not flaky yet
      ['2026-03-09', 2, 7, 0],
      // the third change, on 18 March, makes it flaky (nav changed once)
      ['2026-03-16', 1, 30, 1],
    ])
  })

  it('sums distinct stored bytes per team, counting a shared file in each', async () => {
    const { workspace, owner } = await history()
    const r = await getInsights(t.db, { userId: owner.id, workspaceSlug: workspace.slug, ...range })
    // web: home 1000 (once, though two builds use it) + thumbnail 100 + diff 50
    expect(r?.storage).toEqual({
      teams: [
        { slug: 'docs', name: 'docs', bytes: 1000 },
        { slug: 'web', name: 'web', bytes: 1150 },
      ],
      totalBytes: 2150,
    })
  })

  it('shows each member load', async () => {
    const { workspace, owner, mia } = await history()
    const r = await getInsights(t.db, { userId: owner.id, workspaceSlug: workspace.slug, ...range })
    expect(r?.reviewers).toEqual(
      [
        // decisions in range: f1 and f3. One open request, past due since 19 March 10:00.
        {
          id: owner.id,
          name: owner.name,
          openRequests: 1,
          overdue: 1,
          reviews: 2,
          medianResponseHours: null,
        },
        // decisions in range: f2 and f3 (second). Completed in 12h and 48h; the 48h one was late.
        {
          id: mia.id,
          name: mia.name,
          openRequests: 0,
          overdue: 1,
          reviews: 2,
          medianResponseHours: 30,
        },
      ].toSorted((a, b) => a.name.localeCompare(b.name)),
    )
  })

  it('narrows to one team', async () => {
    const { workspace, owner } = await history()
    const r = await getInsights(t.db, {
      userId: owner.id,
      workspaceSlug: workspace.slug,
      teamSlug: 'docs',
      ...range,
    })
    expect(r?.team).toBe('docs')
    expect(r?.summary).toMatchObject({
      buildsReviewed: 0,
      medianReviewHours: null,
      changeRate: null,
    })
    expect(r?.storage.teams).toEqual([{ slug: 'docs', name: 'docs', bytes: 1000 }])
    expect(r?.weeks.map((w) => w.flaky)).toEqual([0, 0])
  })

  it('is undefined for a stranger, another workspace or an unknown team', async () => {
    const { workspace, owner } = await history()
    const stranger = await seedUser(t.db)
    expect(
      await getInsights(t.db, { userId: stranger.id, workspaceSlug: workspace.slug, ...range }),
    ).toBeUndefined()
    expect(
      await getInsights(t.db, { userId: owner.id, workspaceSlug: 'nope', ...range }),
    ).toBeUndefined()
    expect(
      await getInsights(t.db, {
        userId: owner.id,
        workspaceSlug: workspace.slug,
        teamSlug: 'nope',
        ...range,
      }),
    ).toBeUndefined()
  })
})
