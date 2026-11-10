import {
  addTestMember,
  createTestDb,
  imageSha,
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
import { createTeam, updateTeamSettings } from '#src/repositories/index.ts'
import * as schemaTables from '#src/schema/index.ts'

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
 *   m3 03-18 12:00 changes (hero)                m4 03-19 12:00 no changes (hero shows image A)
 *  Before the range: p1 feature 03-02 10:00 changes, O approves 03-02 16:00 (6h);
 *   p2 main 03-03 10:00 no changes.
 *  The hero image on main goes A (p2), B (m1), A (m2), B (m3), A (m4): a return to an earlier
 *   image at m2, m3 and m4, so it is flaky (3 flip-flops) from m4. nav changes once: never flaky.
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
  const p2 = await make('main', '03-03T10:00', 'no_changes')
  const f1 = await make('feature/a', '03-09T10:00')
  const f2 = await make('feature/b', '03-10T08:00')
  const f3 = await make('feature/c', '03-17T09:00')
  const f4 = await make('feature/d', '03-18T10:00')
  const m1 = await make('main', '03-10T12:00')
  const m2 = await make('main', '03-11T12:00')
  const m3 = await make('main', '03-18T12:00')
  const m4 = await make('main', '03-19T12:00', 'no_changes')
  const p1 = await make('feature/p', '03-02T10:00')

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

  const hero = (buildId: string, image: string, status: 'changed' | 'unchanged' = 'changed') =>
    seedDiff(t.db, { buildId, name: 'hero', status, headSha256: imageSha(image) })
  await hero(p2.id, 'A', 'unchanged')
  await hero(m1.id, 'B')
  await seedDiff(t.db, {
    buildId: m1.id,
    name: 'nav',
    status: 'changed',
    headSha256: imageSha('N'),
  })
  await hero(m2.id, 'A')
  await hero(m3.id, 'B')
  await hero(m4.id, 'A', 'unchanged')

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
      reviewedWithTarget: 3,
      // 8 finished builds in range (f1-f4, m1-m4), 7 with changes
      buildsFinished: 8,
      buildsWithChanges: 7,
      changeRate: 7 / 8,
      // last decisions: f1 2h, f2 12h, f3 48h (Mia decided last); p90 = 12 + 0.8 * 36
      medianDecisionHours: 12,
      p90DecisionHours: 40.8,
      buildsDecided: 3,
      failedBuilds: 0,
    })
    expect(r?.previous).toEqual({
      medianReviewHours: 6,
      p90ReviewHours: 6,
      buildsReviewed: 1,
      reviewedOverTarget: 0,
      reviewedWithTarget: 1,
      buildsFinished: 2,
      buildsWithChanges: 1,
      changeRate: 0.5,
      medianDecisionHours: 6,
      p90DecisionHours: 6,
      buildsDecided: 1,
      failedBuilds: 0,
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
      // hero has returned to an earlier image once by the end of week one: not flaky yet
      ['2026-03-09', 2, 7, 0],
      // the third return, on 19 March, makes it flaky (nav changed once, and only once)
      ['2026-03-16', 1, 30, 1],
    ])
  })

  it('sums distinct stored bytes per team, counting a shared file in each', async () => {
    const { workspace, owner } = await history()
    const r = await getInsights(t.db, { userId: owner.id, workspaceSlug: workspace.slug, ...range })
    // web: home 1000 (once, though two builds use it) + thumbnail 100 + diff 50 + the hero
    // and nav images of main (1 byte each: A, B, N)
    expect(r?.storage).toEqual({
      teams: [
        { slug: 'docs', name: 'docs', colour: expect.any(String), icon: null, bytes: 1000 },
        { slug: 'web', name: 'web', colour: expect.any(String), icon: null, bytes: 1153 },
      ],
      totalBytes: 2153,
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
          image: null,
          openRequests: 1,
          overdue: 1,
          reviews: 2,
          medianResponseHours: null,
        },
        // decisions in range: f2 and f3 (second). Completed in 12h and 48h; the 48h one was late.
        {
          id: mia.id,
          name: mia.name,
          image: null,
          openRequests: 0,
          overdue: 1,
          reviews: 2,
          medianResponseHours: 30,
        },
      ].toSorted((a, b) => a.name.localeCompare(b.name)),
    )
  })

  it('counts a member for every build they decided snapshots on, even when someone else finished it', async () => {
    const { team, workspace, owner } = await seedTeam(t.db)
    const mia = await seedUser(t.db)
    await addTestMember(t.db, { workspaceId: workspace.id, userId: mia.id })
    const at0 = at('03-10T10:00')
    const mk = (ready: string) =>
      seedBuild(t.db, team.id, {
        branch: 'feature/x',
        status: 'complete',
        conclusion: 'changes_detected',
        createdAt: at(ready),
        completedAt: at(ready),
      })
    const b1 = await mk('03-10T08:00')
    const b2 = await mk('03-11T08:00')
    const decide = (
      buildId: string,
      userId: string,
      name: string,
      decision: 'approved' | 'rejected',
    ) =>
      t.db.insert(schemaTables.snapshotReviews).values({
        buildId,
        snapshotName: name,
        decision,
        userId,
        source: 'ui',
        createdAt: at0,
      })
    // b1: Owner rejects `a`, then Mia approves `b`; the build's status only moved once, to rejected
    // by Owner, so only Owner has a build-level review row.
    await decide(b1.id, owner.id, 'a', 'rejected')
    await decide(b1.id, mia.id, 'b', 'approved')
    await seedReview(t.db, { buildId: b1.id, userId: owner.id, state: 'rejected', createdAt: at0 })
    // b2: Mia approves two snapshots; Owner approves a third and so finishes it.
    await decide(b2.id, mia.id, 'a', 'approved')
    await decide(b2.id, mia.id, 'b', 'approved')
    await decide(b2.id, owner.id, 'c', 'approved')
    await seedReview(t.db, { buildId: b2.id, userId: owner.id, createdAt: at0 })
    const r = await getInsights(t.db, { userId: owner.id, workspaceSlug: workspace.slug, ...range })
    expect(Object.fromEntries(r?.reviewers.map((m) => [m.id, m.reviews]) ?? [])).toEqual({
      [owner.id]: 2,
      [mia.id]: 2,
    })
  })

  it('counts what happened in the last minutes before `to`', async () => {
    const { team, workspace, owner } = await seedTeam(t.db)
    const made = at('03-22T23:50')
    const b = await seedBuild(t.db, team.id, {
      branch: 'feature/x',
      status: 'complete',
      conclusion: 'changes_detected',
      createdAt: made,
      completedAt: made,
    })
    await seedReview(t.db, { buildId: b.id, userId: owner.id, createdAt: at('03-22T23:55') })
    const r = await getInsights(t.db, {
      userId: owner.id,
      workspaceSlug: workspace.slug,
      from: at('03-09T00:00'),
      to: at('03-23T00:00'),
    })
    expect(r?.summary).toMatchObject({ buildsFinished: 1, buildsWithChanges: 1, buildsReviewed: 1 })
    expect(r?.reviewers.find((m) => m.id === owner.id)?.reviews).toBe(1)
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
    expect(r?.storage.teams).toEqual([
      { slug: 'docs', name: 'docs', colour: expect.any(String), icon: null, bytes: 1000 },
    ])
    expect(r?.weeks.map((w) => w.flaky)).toEqual([0, 0])
  })

  it("reports the scope's review target, retention and flaky threshold when its teams agree", async () => {
    const { team, workspace, owner } = await seedTeam(t.db)
    const other = await seedTeam(t.db, { workspace: { workspace, owner }, slug: 'docs' })
    const ask = (teamSlug?: string) =>
      getInsights(t.db, {
        userId: owner.id,
        workspaceSlug: workspace.slug,
        ...(teamSlug ? { teamSlug } : {}),
        ...range,
      })
    expect(await ask()).toMatchObject({
      reviewTargetHours: 24,
      retentionDays: { min: 30, max: 30 },
      flakyAfterChanges: 3,
    })
    await updateTeamSettings(t.db, other.team.id, {
      reviewTargetHours: null,
      retentionDays: 90,
      flakyAfterChanges: 5,
    })
    // Teams that differ have no shared target or threshold; retention shows its span.
    expect(await ask()).toMatchObject({
      reviewTargetHours: null,
      retentionDays: { min: 30, max: 90 },
      flakyAfterChanges: null,
    })
    expect(await ask(team.slug)).toMatchObject({ reviewTargetHours: 24, flakyAfterChanges: 3 })
    expect(await ask('docs')).toMatchObject({
      reviewTargetHours: null,
      retentionDays: { min: 90, max: 90 },
      flakyAfterChanges: 5,
    })
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
