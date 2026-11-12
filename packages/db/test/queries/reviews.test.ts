import {
  addTestMember,
  createTestDb,
  seedFlipFlops,
  seedBuild,
  seedDiff,
  seedProject,
  seedReview,
  seedReviewRequest,
  seedUser,
} from '@circi/db/testing'
import { and, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { listReviewRequests } from '#src/queries/index.ts'
import * as schema from '#src/schema/index.ts'

let t: createTestDb.Result
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(async () => {
  await t.close()
})

const now = new Date('2026-03-10T12:00:00.000Z')
const hoursFromNow = (h: number) => new Date(now.getTime() + h * 3_600_000)

/** A workspace with an owner (the reviewer), a teammate who asks, and one build to review. */
async function setup() {
  const { project, workspace, owner } = await seedProject(t.db)
  const teammate = await seedUser(t.db)
  await addTestMember(t.db, { workspaceId: workspace.id, userId: teammate.id })
  const build = await seedBuild(t.db, project.id, { branch: 'feature/x', prNumber: 7 })
  return { project, workspace, owner, teammate, build }
}

describe('listReviewRequests', () => {
  it("counts the build's changes and lists its changed screenshots, biggest first", async () => {
    const { owner, build } = await setup()
    await seedReviewRequest(t.db, { buildId: build.id, reviewerId: owner.id })
    for (const [name, status, score] of [
      ['a', 'changed', 0.01],
      ['b', 'changed', 0.2],
      ['c', 'changed', 0.05],
      ['d', 'added', null],
      ['e', 'unchanged', 0],
    ] as const) {
      // oxlint-disable-next-line no-await-in-loop -- tiny fixed list
      await seedDiff(t.db, { buildId: build.id, name, status })
      // oxlint-disable-next-line no-await-in-loop -- tiny fixed list
      await t.db
        .update(schema.screenshotDiffs)
        .set({ score })
        .where(
          and(eq(schema.screenshotDiffs.buildId, build.id), eq(schema.screenshotDiffs.name, name)),
        )
    }
    const [item] = await listReviewRequests(t.db, { userId: owner.id, tab: 'for-you', now })
    expect(item?.changes).toEqual({ changed: 3, added: 1, removed: 0, unchanged: 1 })
    // Every changed screenshot, biggest change first; not the added or unchanged ones.
    expect(item?.changedScreenshots.map((c) => [c.name, c.score])).toEqual([
      ['b', 0.2],
      ['c', 0.05],
      ['a', 0.01],
    ])
  })

  it('shows what is asked of you with the build and project, and how overdue it is', async () => {
    const { project, workspace, owner, teammate, build } = await setup()
    await seedReviewRequest(t.db, {
      buildId: build.id,
      reviewerId: owner.id,
      requestedById: teammate.id,
      dueAt: hoursFromNow(-3),
    })

    const [item, ...rest] = await listReviewRequests(t.db, {
      userId: owner.id,
      tab: 'for-you',
      now,
    })
    expect(rest).toEqual([])
    expect(item).toMatchObject({
      state: 'open',
      overdueByMs: 3 * 3_600_000,
      reviewer: { id: owner.id },
      requestedBy: { id: teammate.id, name: teammate.name },
      build: { number: 1, branch: 'feature/x', prNumber: 7 },
      project: { slug: project.slug },
      workspace: { slug: workspace.slug },
    })
  })

  it('is not overdue on time or without a review target', async () => {
    const { owner, build, teammate } = await setup()
    const b2 = await seedBuild(t.db, build.projectId)
    await seedReviewRequest(t.db, {
      buildId: build.id,
      reviewerId: owner.id,
      requestedById: teammate.id,
      dueAt: hoursFromNow(2),
    })
    await seedReviewRequest(t.db, { buildId: b2.id, reviewerId: owner.id, dueAt: null })
    const items = await listReviewRequests(t.db, { userId: owner.id, tab: 'for-you', now })
    expect(items.map((i) => [i.build.number, i.overdueByMs, i.requestedBy?.id ?? null])).toEqual([
      [1, 0, teammate.id], // soonest due first, without a due time last
      [2, 0, null],
    ])
  })

  it('splits for you, created by you and snoozed, and leaves closed requests out', async () => {
    const { owner, teammate, build } = await setup()
    const b2 = await seedBuild(t.db, build.projectId)
    const b3 = await seedBuild(t.db, build.projectId)
    const b4 = await seedBuild(t.db, build.projectId)
    await seedReviewRequest(t.db, {
      buildId: build.id,
      reviewerId: owner.id,
      requestedById: teammate.id,
    })
    await seedReviewRequest(t.db, {
      buildId: b2.id,
      reviewerId: owner.id,
      requestedById: teammate.id,
      dueAt: hoursFromNow(-5),
      snoozedUntil: hoursFromNow(1),
      snoozeKind: 'tomorrow',
    })
    await seedReviewRequest(t.db, {
      buildId: b3.id,
      reviewerId: owner.id,
      requestedById: teammate.id,
      snoozeKind: 'next_push',
    })
    await seedReviewRequest(t.db, {
      buildId: b4.id,
      reviewerId: teammate.id,
      requestedById: owner.id,
    })
    await seedReviewRequest(t.db, {
      buildId: b4.id,
      reviewerId: owner.id,
      requestedById: teammate.id,
      state: 'done',
    })

    const numbers = async (userId: string, tab: 'for-you' | 'created' | 'snoozed') =>
      (await listReviewRequests(t.db, { userId, tab, now })).map((i) => i.build.number)
    expect(await numbers(owner.id, 'for-you')).toEqual([1])
    expect((await numbers(owner.id, 'snoozed')).toSorted((a, b) => a - b)).toEqual([2, 3])
    expect(await numbers(owner.id, 'created')).toEqual([4])
    expect(await numbers(teammate.id, 'for-you')).toEqual([4])

    // A snooze that has run out is awake again, and counts as overdue again.
    const later = new Date(hoursFromNow(2))
    const woken = await listReviewRequests(t.db, { userId: owner.id, tab: 'for-you', now: later })
    expect(woken.map((i) => i.build.number).toSorted((a, b) => a - b)).toEqual([1, 2])
    expect(woken.find((i) => i.build.number === 2)?.overdueByMs).toBe(7 * 3_600_000)
  })

  it('does not show a snoozed request as overdue', async () => {
    const { owner, build } = await setup()
    await seedReviewRequest(t.db, {
      buildId: build.id,
      reviewerId: owner.id,
      dueAt: hoursFromNow(-5),
      snoozeKind: 'next_push',
    })
    const [item] = await listReviewRequests(t.db, { userId: owner.id, tab: 'snoozed', now })
    expect(item?.overdueByMs).toBe(0)
  })

  it('shows overdue only while the review is awaited', async () => {
    const { owner, build } = await setup()
    // Closed by a decision: its target no longer matters, in the Reviewed tab or anywhere.
    await seedReviewRequest(t.db, {
      buildId: build.id,
      reviewerId: owner.id,
      dueAt: hoursFromNow(-5),
      state: 'done',
      closedAt: hoursFromNow(-1),
    })
    const [reviewed] = await listReviewRequests(t.db, { userId: owner.id, tab: 'reviewed', now })
    expect(reviewed?.dueAt).not.toBeNull()
    expect(reviewed?.overdueByMs).toBe(0)

    // Still open but the build was decided meanwhile (say, by someone else): not awaited either.
    const decided = await seedBuild(t.db, build.projectId, { reviewStatus: 'approved' })
    await seedReviewRequest(t.db, {
      buildId: decided.id,
      reviewerId: owner.id,
      dueAt: hoursFromNow(-5),
    })
    // Undecided and open: overdue.
    const waiting = await seedBuild(t.db, build.projectId)
    await seedReviewRequest(t.db, {
      buildId: waiting.id,
      reviewerId: owner.id,
      dueAt: hoursFromNow(-5),
    })
    const open = await listReviewRequests(t.db, { userId: owner.id, tab: 'for-you', now })
    expect(open.map((i) => [i.build.number, i.overdueByMs])).toEqual(
      expect.arrayContaining([
        [decided.number, 0],
        [waiting.number, 5 * 3_600_000],
      ]),
    )
  })

  it('keeps the names the people had when asked, for when an account is gone', async () => {
    const { owner, teammate, build } = await setup()
    await seedReviewRequest(t.db, {
      buildId: build.id,
      reviewerId: owner.id,
      requestedById: teammate.id,
    })
    const [before] = await listReviewRequests(t.db, { userId: owner.id, tab: 'for-you', now })
    expect(before?.requestedBy?.id).toBe(teammate.id)
    expect(before?.requestedByName).toBe(before?.requestedBy?.name)
    const kept = before?.requestedByName
    expect(kept).toBeTruthy()

    await t.db.delete(schema.user).where(eq(schema.user.id, teammate.id))
    const [after] = await listReviewRequests(t.db, { userId: owner.id, tab: 'for-you', now })
    expect(after?.requestedBy).toBeNull()
    expect(after?.requestedByName).toBe(kept)
  })

  it('counts the changed screenshots that are flaky on the default branch', async () => {
    const { project, owner, build } = await setup()
    await t.db
      .update(schema.projects)
      .set({ flakyAfterChanges: 2 })
      .where(eq(schema.projects.id, project.id))
    await seedFlipFlops(t.db, project.id, 'clock', ['A', 'B', 'A', 'B'])
    await seedReviewRequest(t.db, { buildId: build.id, reviewerId: owner.id })
    await seedDiff(t.db, { buildId: build.id, name: 'clock', status: 'changed' })
    await seedDiff(t.db, { buildId: build.id, name: 'hero', status: 'changed' })
    // An unchanged flaky screenshot doesn't count.
    await seedDiff(t.db, { buildId: build.id, name: 'other', status: 'unchanged' })
    const [item] = await listReviewRequests(t.db, { userId: owner.id, tab: 'for-you', now })
    expect(item?.flakyChanges).toBe(1)
  })

  it("never shows another workspace's requests", async () => {
    const mine = await setup()
    const theirs = await setup()
    await seedReviewRequest(t.db, { buildId: theirs.build.id, reviewerId: theirs.owner.id })
    // Even a request that names me as the reviewer is invisible once I am not in its workspace.
    await seedReviewRequest(t.db, {
      buildId: theirs.build.id,
      reviewerId: mine.owner.id,
      requestedById: mine.owner.id,
    })
    const tabs = await Promise.all(
      (['for-you', 'created', 'snoozed', 'reviewed', 'all-open'] as const).map((tab) =>
        listReviewRequests(t.db, { userId: mine.owner.id, tab, now }),
      ),
    )
    expect(tabs).toEqual([[], [], [], [], []])
  })

  it("lists everyone's open requests under all-open, and your closed ones under reviewed", async () => {
    const { owner, teammate, project, build } = await setup()
    const b2 = await seedBuild(t.db, project.id, { branch: 'feature/y' })
    await seedReviewRequest(t.db, { buildId: build.id, reviewerId: teammate.id })
    const closed = await seedReviewRequest(t.db, {
      buildId: b2.id,
      reviewerId: owner.id,
      state: 'done',
      closedAt: hoursFromNow(-2),
    })
    const older = await seedReviewRequest(t.db, {
      buildId: build.id,
      reviewerId: owner.id,
      state: 'done',
      closedAt: hoursFromNow(-9),
    })
    await seedReview(t.db, { buildId: b2.id, userId: owner.id, state: 'rejected' })
    await seedReview(t.db, { buildId: build.id, userId: owner.id, state: 'approved' })

    const open = await listReviewRequests(t.db, { userId: owner.id, tab: 'all-open', now })
    expect(open.map((i) => i.reviewer.id)).toEqual([teammate.id])

    const done = await listReviewRequests(t.db, { userId: owner.id, tab: 'reviewed', now })
    expect(done.map((i) => [i.id, i.decision])).toEqual([
      [closed.id, 'rejected'],
      [older.id, 'approved'],
    ])
    expect(done[0]?.closedAt).toEqual(hoursFromNow(-2))
    // Nobody else's closed requests.
    expect(await listReviewRequests(t.db, { userId: teammate.id, tab: 'reviewed', now })).toEqual(
      [],
    )
  })

  it('says why a request is back: a rejected earlier build of the branch, or asked again', async () => {
    const { owner, teammate, project } = await setup()
    const first = await seedBuild(t.db, project.id, { branch: 'fix/header' })
    const second = await seedBuild(t.db, project.id, { branch: 'fix/header' })
    const other = await seedBuild(t.db, project.id, { branch: 'fix/other' })
    await seedReview(t.db, { buildId: first.id, userId: owner.id, state: 'rejected' })
    await seedReviewRequest(t.db, { buildId: second.id, reviewerId: owner.id })
    // A fresh branch with no history, and a build asked about twice.
    await seedReviewRequest(t.db, {
      buildId: other.id,
      reviewerId: owner.id,
      state: 'dismissed',
      closedAt: hoursFromNow(-1),
    })
    await seedReviewRequest(t.db, { buildId: other.id, reviewerId: owner.id })
    await seedReviewRequest(t.db, { buildId: first.id, reviewerId: teammate.id })

    const items = await listReviewRequests(t.db, { userId: owner.id, tab: 'for-you', now })
    const reason = (n: number) => items.find((i) => i.build.number === n)?.reason
    expect(reason(second.number)).toEqual({ kind: 'rejected_earlier', buildNumber: first.number })
    expect(reason(other.number)).toEqual({ kind: 're_requested' })
    const all = await listReviewRequests(t.db, { userId: owner.id, tab: 'all-open', now })
    // The teammate's request on the first build has no history of its own.
    expect(all.find((i) => i.reviewer.id === teammate.id)?.reason).toBeNull()
  })

  it('names the build it was compared with', async () => {
    const { owner, build, project } = await setup()
    const base = await seedBuild(t.db, project.id, { branch: 'main' })
    await t.db
      .update(schema.builds)
      .set({ baseBuildId: base.id })
      .where(eq(schema.builds.id, build.id))
    await seedReviewRequest(t.db, { buildId: build.id, reviewerId: owner.id })
    const [item] = await listReviewRequests(t.db, { userId: owner.id, tab: 'for-you', now })
    expect(item?.baseline).toEqual({ number: base.number, branch: 'main' })
  })
})
