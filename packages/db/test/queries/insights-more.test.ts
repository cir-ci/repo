import {
  addTestMember,
  createTestDb,
  seedBuild,
  seedDiff,
  seedReview,
  seedTeam,
  seedUser,
} from '@circi/db/testing'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { getInsights } from '#src/queries/index.ts'
import { addIgnoreRegion, createTeam } from '#src/repositories/index.ts'
import * as schema from '#src/schema/index.ts'

let t: createTestDb.Result
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(async () => {
  await t.close()
})

const at = (iso: string) => new Date(`2026-${iso}:00Z`)
const range = { from: at('03-09T00:00'), to: at('03-23T00:00'), now: at('03-20T00:00') }

/**
 * Team `web` (main, 24h target) and `docs`, plus a `secret` team the viewer is not in. Range:
 * Mon 9 to Mon 23 March, now = 20 March 00:00. Web's history (ready time; M is Mia, who decides):
 *  w1 feature 03-09 10:00 changes, M approves 12:00 (2h); processing 4 min
 *  w2 feature 03-10 08:00 changes, M rejects 20:00 with "Wrong font" (12h), and rejected `hero`
 *     at 19:00 with "Too tall"; processing 8 min
 *  w3 feature 03-17 09:00 changes, waiting (past its target); w4 03-19 10:00 changes, waiting,
 *     with `hero` rejected on one screenshot and no reason
 *  main: a1 03-11, m2 03-12, m3 03-13 changes (`hero`), auto-approved; n1 03-14 no changes,
 *     auto-approved, with ignore-region hits on `hero` (40 px) and `home` (5 px)
 *  errors 03-13: two timed-out-shards messages and one upload-never-finished
 * docs: one no-change build 03-12 (auto-approved). Secret: a waiting build and a failed one.
 */
async function history() {
  const { team, workspace, owner } = await seedTeam(t.db, { slug: 'web' })
  const docs = await createTeam(t.db, { workspaceSlug: workspace.slug, name: 'docs' })
  const secret = await createTeam(t.db, { workspaceSlug: workspace.slug, name: 'secret' })
  const mia = await seedUser(t.db)
  await addTestMember(t.db, {
    workspaceId: workspace.id,
    userId: mia.id,
    teams: [team.id, docs.id],
  })

  const make = async (
    teamId: string,
    branch: string,
    ready: string,
    over: {
      conclusion?: 'changes_detected' | 'no_changes'
      review?: 'approved' | 'rejected' | 'pending'
      minutes?: number
      names?: string[]
    } = {},
  ) => {
    const b = await seedBuild(t.db, teamId, {
      branch,
      status: 'complete',
      conclusion: over.conclusion ?? 'changes_detected',
      reviewStatus: over.review ?? 'pending',
      createdAt: at(ready),
      completedAt: at(ready),
      ...(over.names ? { changedSnapshots: over.names } : {}),
    })
    if (over.minutes !== undefined) {
      await t.db
        .update(schema.builds)
        .set({ finalizedAt: new Date(at(ready).getTime() - over.minutes * 60_000) })
        .where(eq(schema.builds.id, b.id))
    }
    return b
  }
  const w1 = await make(team.id, 'feature/a', '03-09T10:00', {
    review: 'approved',
    minutes: 4,
    names: ['home'],
  })
  const w2 = await make(team.id, 'feature/b', '03-10T08:00', {
    review: 'rejected',
    minutes: 8,
    names: ['home'],
  })
  await make(team.id, 'feature/c', '03-17T09:00', { minutes: 6 })
  const w4 = await make(team.id, 'feature/d', '03-19T10:00', { minutes: 10 })
  const main = { review: 'approved' as const, minutes: 2, names: ['hero'] }
  const a1 = await make(team.id, 'main', '03-11T12:00', main)
  const m2 = await make(team.id, 'main', '03-12T12:00', main)
  const m3 = await make(team.id, 'main', '03-13T12:00', main)
  const n1 = await make(team.id, 'main', '03-14T12:00', {
    conclusion: 'no_changes',
    review: 'approved',
    minutes: 2,
  })
  await make(docs.id, 'main', '03-12T09:00', {
    conclusion: 'no_changes',
    review: 'approved',
    minutes: 2,
  })

  await seedReview(t.db, { buildId: w1.id, userId: mia.id, createdAt: at('03-09T12:00') })
  await seedReview(t.db, {
    buildId: w2.id,
    userId: mia.id,
    state: 'rejected',
    reason: 'Wrong font',
    createdAt: at('03-10T20:00'),
  })
  await seedReview(t.db, { buildId: a1.id, userId: null, createdAt: at('03-11T12:00') })
  await seedReview(t.db, { buildId: m2.id, userId: null, createdAt: at('03-12T12:00') })
  await seedReview(t.db, { buildId: m3.id, userId: null, createdAt: at('03-13T12:00') })
  const reject = (buildId: string, reason: string | null, when: string) =>
    t.db.insert(schema.snapshotReviews).values({
      buildId,
      snapshotName: 'hero',
      decision: 'rejected',
      userId: mia.id,
      source: 'ui',
      reason,
      createdAt: at(when),
    })
  await reject(w2.id, 'Too tall', '03-10T19:00')
  await reject(w4.id, null, '03-19T11:00')

  await seedDiff(t.db, { buildId: n1.id, name: 'home', status: 'unchanged' })
  await t.db
    .update(schema.screenshotDiffs)
    .set({ ignoredChangedPixels: 5, ignoredRegions: ['home'] })
    .where(eq(schema.screenshotDiffs.buildId, n1.id))
  await seedDiff(t.db, {
    buildId: n1.id,
    name: 'hero',
    status: 'unchanged',
    ignoredChangedPixels: 40,
    ignoredRegions: ['hero'],
  })
  await addIgnoreRegion(t.db, team.id, { name: 'hero', x: 0, y: 0, width: 10, height: 10 })

  const fail = async (teamId: string, message: string) => {
    const b = await seedBuild(t.db, teamId, {
      branch: 'feature/e',
      status: 'error',
      createdAt: at('03-13T10:00'),
      completedAt: at('03-13T10:00'),
    })
    await t.db
      .update(schema.builds)
      .set({ errorMessage: message })
      .where(eq(schema.builds.id, b.id))
  }
  await fail(team.id, 'Timed out waiting for 2 of 4 shard(s): shard 3, 4. The CI job(s) failed.')
  await fail(team.id, 'Timed out waiting for 1 of 2 shard(s). The CI job(s) failed.')
  await fail(team.id, 'The upload never finished: the CI job stopped before sending the list.')
  // The secret team: a waiting build and a failure that must not show to someone outside it.
  await make(secret.id, 'feature/s', '03-16T10:00')
  await fail(secret.id, 'Secret failure')
  await seedBuild(t.db, secret.id, {
    branch: 'feature/s2',
    status: 'complete',
    conclusion: 'changes_detected',
    createdAt: at('03-12T10:00'),
    completedAt: at('03-12T10:00'),
    changedSnapshots: ['secret-shot'],
  })
  return { workspace, owner, mia }
}

const ask = (userId: string, workspaceSlug: string, teamSlug?: string) =>
  getInsights(t.db, { userId, workspaceSlug, ...(teamSlug ? { teamSlug } : {}), ...range })

describe('getInsights: time to decision, outcomes and CI health', () => {
  it('measures ready to the last decision by a person, in the summary and per week', async () => {
    const { workspace, mia } = await history()
    const r = await ask(mia.id, workspace.slug)
    // w1 2h and w2 12h; the automatic approvals are not decisions by a person
    expect(r?.summary).toMatchObject({
      medianDecisionHours: 7,
      p90DecisionHours: 11,
      buildsDecided: 2,
      failedBuilds: 3,
    })
    expect(r?.previous).toMatchObject({ medianDecisionHours: null, buildsDecided: 0 })
    expect(r?.bucket).toBe('week')
    expect(r?.weeks[0]).toMatchObject({ medianDecisionHours: 7, p90DecisionHours: 11, decided: 2 })
    expect(r?.weeks[1]).toMatchObject({ medianDecisionHours: null, decided: 0 })
  })

  it('counts one outcome per finished build, leaving waiting builds out', async () => {
    const { workspace, mia } = await history()
    const r = await ask(mia.id, workspace.slug)
    // week 1: w1 approved, w2 rejected, a1 m2 m3 n1 and the docs build auto-approved, 3 errors
    expect(r?.weeks[0]?.outcomes).toEqual({
      approved: 1,
      autoApproved: 5,
      rejected: 1,
      failed: 3,
    })
    // week 2: w3 and w4 still wait
    expect(r?.weeks[1]?.outcomes).toEqual({ approved: 0, autoApproved: 0, rejected: 0, failed: 0 })
    expect(r?.weeks[0]?.failedBuilds).toBe(3)
  })

  it('takes processing time from finalizing to completing, finished builds only', async () => {
    const { workspace, mia } = await history()
    const r = await ask(mia.id, workspace.slug)
    // 2, 2, 2, 2, 2 (main, n1, docs), 4 and 8
    expect(r?.weeks[0]?.medianProcessingMinutes).toBe(2)
    expect(r?.weeks[0]?.p90ProcessingMinutes).toBeCloseTo(5.6)
    expect(r?.weeks[1]?.medianProcessingMinutes).toBe(8)
  })

  it('groups why builds failed, most common first', async () => {
    const { workspace, mia } = await history()
    const r = await ask(mia.id, workspace.slug)
    expect(r?.failureReasons).toEqual([
      { message: 'Timed out waiting for shards', builds: 2 },
      {
        message: 'Upload never finished: the CI job stopped before sending the screenshot list',
        builds: 1,
      },
    ])
  })

  it('shows one bar per day for a range of 7 days', async () => {
    const { workspace, mia } = await history()
    const r = await getInsights(t.db, {
      userId: mia.id,
      workspaceSlug: workspace.slug,
      from: at('03-13T00:00'),
      to: at('03-20T00:00'),
      now: at('03-20T00:00'),
    })
    expect(r?.bucket).toBe('day')
    expect(r?.weeks).toHaveLength(7)
    expect(r?.weeks[0]?.weekStart.toISOString()).toBe('2026-03-13T00:00:00.000Z')
    // 13 March: m3 auto-approved, three failures
    expect(r?.weeks[0]?.outcomes).toMatchObject({ autoApproved: 1, failed: 3 })
  })
})

describe('getInsights: the queue', () => {
  it('counts builds waiting at the end of each day, and now', async () => {
    const { workspace, mia } = await history()
    const r = await ask(mia.id, workspace.slug)
    expect(r?.backlog.map((d) => d.waiting)).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 2, 2])
    expect(r?.backlog[0]?.day.toISOString()).toBe('2026-03-09T00:00:00.000Z')
    expect(r?.waitingNow).toBe(2)
  })

  it('lists the oldest waiting builds, past-target ones flagged', async () => {
    const { workspace, mia } = await history()
    const r = await ask(mia.id, workspace.slug)
    expect(r?.oldestWaiting.map((w) => [w.branch, w.overTarget, w.team.slug])).toEqual([
      ['feature/c', true, 'web'],
      ['feature/d', false, 'web'],
    ])
    expect(r?.oldestWaiting[0]?.readyAt.toISOString()).toBe('2026-03-17T09:00:00.000Z')
  })

  it('leaves out teams the person cannot see, everywhere', async () => {
    const { workspace, owner, mia } = await history()
    const hidden = await ask(mia.id, workspace.slug)
    expect(hidden?.waitingNow).toBe(2)
    expect(hidden?.teamsComparison.map((c) => c.team.slug)).toEqual(['web', 'docs'])
    expect(hidden?.failureReasons.map((f) => f.message)).not.toContain('Secret failure')
    expect(hidden?.mostChanged.map((c) => c.name)).not.toContain('secret-shot')
    const all = await ask(owner.id, workspace.slug)
    expect(all?.waitingNow).toBe(4)
    expect(all?.teamsComparison.map((c) => c.team.slug)).toContain('secret')
    expect(all?.failureReasons.map((f) => f.message)).toContain('Secret failure')
  })
})

describe('getInsights: screenshots', () => {
  it('ranks the most changed, with the last 10 default-branch builds', async () => {
    const { workspace, mia } = await history()
    const r = await ask(mia.id, workspace.slug)
    // hero changed in the three main builds and was unchanged in n1; home in w1 and w2
    expect(r?.mostChanged.map((c) => [c.name, c.changedBuilds, c.builds])).toEqual([
      ['hero', 3, 4],
      ['home', 2, 3],
    ])
    // main builds oldest first: a1, m2, m3 changed hero; n1 did not
    expect(r?.mostChanged[0]?.last10).toEqual([true, true, true, false])
    expect(r?.mostChanged[0]?.team.slug).toBe('web')
  })

  it('lists the flaky screenshots by the team rule', async () => {
    const { workspace, mia } = await history()
    const r = await ask(mia.id, workspace.slug)
    expect(r?.flakiest).toEqual([
      {
        team: expect.objectContaining({ slug: 'web' }),
        name: 'hero',
        changedBuilds: 3,
        builds: 4,
        last10: [true, true, true, false],
      },
    ])
  })
})

describe('getInsights: rejections', () => {
  it('counts rejected builds, those with a reason, and lists the latest reasons', async () => {
    const { workspace, mia } = await history()
    const r = await ask(mia.id, workspace.slug)
    // w2 (whole build and a screenshot) and w4 (a screenshot, no reason)
    expect(r?.rejections.rejectedBuilds).toBe(2)
    expect(r?.rejections.withReason).toBe(1)
    expect(r?.rejections.recent).toEqual([
      {
        buildId: expect.any(String),
        number: expect.any(Number),
        team: expect.objectContaining({ slug: 'web' }),
        reviewer: mia.name,
        reason: 'Wrong font',
        at: at('03-10T20:00'),
      },
    ])
  })

  it('counts every rejection of a screenshot', async () => {
    const { workspace, mia } = await history()
    const r = await ask(mia.id, workspace.slug)
    expect(r?.mostRejected).toEqual([
      { team: expect.objectContaining({ slug: 'web' }), name: 'hero', rejections: 2 },
    ])
  })
})

describe('getInsights: teams and ignore regions', () => {
  it('compares the teams in view, busiest first, and nothing for one team', async () => {
    const { workspace, mia } = await history()
    const r = await ask(mia.id, workspace.slug)
    expect(r?.teamsComparison).toEqual([
      {
        team: expect.objectContaining({ slug: 'web', colour: expect.any(String) }),
        builds: 8,
        buildsWithChanges: 7,
        medianReviewHours: 7,
        reviewTargetHours: 24,
        flaky: 1,
        failed: 3,
      },
      {
        team: expect.objectContaining({ slug: 'docs' }),
        builds: 1,
        buildsWithChanges: 0,
        medianReviewHours: null,
        reviewTargetHours: 24,
        flaky: 0,
        failed: 0,
      },
    ])
    expect((await ask(mia.id, workspace.slug, 'web'))?.teamsComparison).toEqual([])
  })

  it('counts the diffs ignore regions kept unchanged, by region', async () => {
    const { workspace, mia } = await history()
    const r = await ask(mia.id, workspace.slug)
    expect(r?.ignoreRegions).toEqual({
      suppressedDiffs: 2,
      top: [
        { team: expect.objectContaining({ slug: 'web' }), region: 'hero', diffs: 1 },
        { team: expect.objectContaining({ slug: 'web' }), region: 'home', diffs: 1 },
      ],
    })
  })

  it('has no ignore regions card when no team in view has a region', async () => {
    const { workspace, mia } = await history()
    expect((await ask(mia.id, workspace.slug, 'docs'))?.ignoreRegions).toBeNull()
  })
})
