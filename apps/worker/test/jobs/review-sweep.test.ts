import { createBuild, schema } from '@circi/db'
import { snoozeReviewRequest } from '@circi/services'
import {
  addTestMember,
  createTestDb,
  seedProject,
  seedReviewRequest,
  seedUser,
} from '@circi/testing'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { reviewSweep } from '#jobs/review-sweep.ts'

let t: createTestDb.Result
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(async () => {
  await t.close()
})

const due = new Date('2026-03-10T12:00:00.000Z')
const after = new Date('2026-03-10T15:00:00.000Z')

async function setup(dueAt: Date | null = due) {
  const { project, org } = await seedProject(t.db)
  const reviewer = await seedUser(t.db)
  await addTestMember(t.db, { orgId: org.id, userId: reviewer.id })
  const build = await createBuild(t.db, {
    projectId: project.id,
    commitSha: 'abc1234',
    branch: 'f',
  })
  const request = await seedReviewRequest(t.db, {
    buildId: build.id,
    reviewerId: reviewer.id,
    dueAt,
  })
  return { project, reviewer, build, request }
}

const overdueFor = (userId: string) =>
  t.db
    .select()
    .from(schema.notifications)
    .where(eq(schema.notifications.userId, userId))
    .then((rows) => rows.filter((n) => n.kind === 'review_overdue'))

describe('reviewSweep', () => {
  it('tells the reviewer once, however often it runs', async () => {
    const { reviewer, build, request } = await setup()
    expect(await reviewSweep({ db: t.db, now: after })).toBe(1)
    expect(await reviewSweep({ db: t.db, now: after })).toBe(0)
    expect(await reviewSweep({ db: t.db, now: new Date('2026-03-12T00:00:00.000Z') })).toBe(0)
    const sent = await overdueFor(reviewer.id)
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({
      buildId: build.id,
      actorId: null,
      payload: { requestId: request.id, overdueByMs: 3 * 3_600_000 },
    })
  })

  it('stays quiet for a request not yet due (exactly due included) or without a due time', async () => {
    const early = await setup(new Date('2026-03-10T18:00:00.000Z'))
    const exact = await setup(after)
    const never = await setup(null)
    expect(await reviewSweep({ db: t.db, now: after })).toBe(0)
    for (const s of [early, exact, never]) {
      // oxlint-disable-next-line no-await-in-loop -- three tiny queries
      expect(await overdueFor(s.reviewer.id)).toEqual([])
    }
  })

  it('stays quiet while snoozed, and tells them after the snooze ends', async () => {
    const { project, reviewer, request } = await setup()
    await snoozeReviewRequest(t.db, {
      projectId: project.id,
      requestId: request.id,
      userId: reviewer.id,
      kind: 'tomorrow',
      now: after,
    })
    expect(await reviewSweep({ db: t.db, now: after })).toBe(0)
    expect(await overdueFor(reviewer.id)).toEqual([])
    await reviewSweep({ db: t.db, now: new Date('2026-03-11T10:00:00.000Z') })
    expect(await overdueFor(reviewer.id)).toHaveLength(1)
  })

  it('skips closed requests, and does not repeat after the notice is deleted', async () => {
    const closed = await setup()
    await t.db
      .update(schema.reviewRequests)
      .set({ state: 'dismissed' })
      .where(eq(schema.reviewRequests.id, closed.request.id))
    const open = await setup()
    expect(await reviewSweep({ db: t.db, now: after })).toBe(1)
    await t.db
      .update(schema.notifications)
      .set({ deletedAt: new Date() })
      .where(eq(schema.notifications.userId, open.reviewer.id))
    expect(await reviewSweep({ db: t.db, now: after })).toBe(0)
    expect(await overdueFor(closed.reviewer.id)).toEqual([])
  })
})
