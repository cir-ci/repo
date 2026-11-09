import {
  addTestMember,
  createTestDb,
  seedBuild,
  seedComment,
  seedTeam,
  seedReview,
  seedReviewRequest,
  seedUser,
} from '@circi/db/testing'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { listBuildActivity } from '#src/queries/index.ts'
import { setCheckRunId } from '#src/queue/index.ts'
import { recordSnapshotReviews } from '#src/repositories/index.ts'
import * as schema from '#src/schema/index.ts'

let t: createTestDb.Result
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(async () => {
  await t.close()
})

const at = (minute: number) => new Date(Date.UTC(2026, 2, 10, 12, minute))

describe('listBuildActivity', () => {
  it('merges every source into one list, oldest first, whatever order it was written in', async () => {
    const { team, workspace, owner } = await seedTeam(t.db)
    const bob = await seedUser(t.db)
    await addTestMember(t.db, { workspaceId: workspace.id, userId: bob.id })
    const build = await seedBuild(t.db, team.id, {
      status: 'complete',
      conclusion: 'changes_detected',
      createdAt: at(0),
      completedAt: at(3),
    })
    await t.db
      .update(schema.builds)
      .set({ finalizedAt: at(1) })
      .where(eq(schema.builds.id, build.id))
    await setCheckRunId(t.db, build.id, 'run-1')
    await t.db
      .update(schema.buildChecks)
      .set({ createdAt: at(2) })
      .where(eq(schema.buildChecks.buildId, build.id))

    await seedReview(t.db, {
      buildId: build.id,
      userId: bob.id,
      state: 'rejected',
      reason: 'clipped',
      createdAt: at(7),
    })
    await seedComment(t.db, {
      buildId: build.id,
      authorId: owner.id,
      body: 'second',
      createdAt: at(8),
    })
    await seedComment(t.db, {
      buildId: build.id,
      authorId: owner.id,
      body: 'first',
      createdAt: at(5),
    })
    await seedComment(t.db, {
      buildId: build.id,
      authorId: owner.id,
      body: 'gone',
      createdAt: at(6),
      deletedAt: at(9),
    })
    await seedReviewRequest(t.db, {
      buildId: build.id,
      reviewerId: bob.id,
      requestedById: owner.id,
      state: 'done',
      createdAt: at(4),
      closedAt: at(7),
    })
    await seedReview(t.db, {
      buildId: build.id,
      userId: null,
      state: 'approved',
      createdAt: at(10),
    })

    const events = await listBuildActivity(t.db, build.id)
    expect(events.map((e) => [e.at.getUTCMinutes(), e.type])).toEqual([
      [0, 'uploaded'],
      [1, 'processing'],
      [2, 'check_created'],
      [3, 'completed'],
      [4, 'review_requested'],
      [5, 'comment'],
      [7, 'review_request_closed'],
      [7, 'review'],
      [8, 'comment'],
      [10, 'review'],
    ])
    expect(events.find((e) => e.type === 'review' && e.by)).toMatchObject({
      state: 'rejected',
      source: 'ui',
      reason: 'clipped',
      by: { id: bob.id },
    })
    expect(events.find((e) => e.type === 'review' && !e.by)).toMatchObject({
      state: 'approved',
      source: 'auto',
    })
    expect(events.find((e) => e.type === 'review_requested')).toMatchObject({
      reviewer: { id: bob.id },
      by: { id: owner.id },
    })
  })

  it('shows a failed build as failed, with its message', async () => {
    const { team } = await seedTeam(t.db)
    const build = await seedBuild(t.db, team.id, {
      status: 'error',
      createdAt: at(0),
      completedAt: at(2),
    })
    const events = await listBuildActivity(t.db, build.id)
    expect(events.map((e) => e.type)).toEqual(['uploaded', 'failed'])
  })

  it('is empty for an unknown build', async () => {
    expect(await listBuildActivity(t.db, '00000000-0000-4000-8000-000000000000')).toEqual([])
  })

  it('groups the snapshots one action decided into one event', async () => {
    const { team, owner } = await seedTeam(t.db)
    const build = await seedBuild(t.db, team.id, {
      status: 'complete',
      conclusion: 'changes_detected',
      changedSnapshots: ['a', 'b', 'c'],
    })
    await recordSnapshotReviews(t.db, {
      buildId: build.id,
      userId: owner.id,
      decision: 'rejected',
      snapshotNames: ['a'],
      reason: 'off by a pixel',
    })
    await recordSnapshotReviews(t.db, {
      buildId: build.id,
      userId: owner.id,
      decision: 'approved',
      snapshotNames: 'undecided',
    })
    const events = (await listBuildActivity(t.db, build.id)).filter(
      (e) => e.type === 'snapshot_review',
    )
    expect(events).toMatchObject([
      {
        decision: 'rejected',
        snapshotNames: ['a'],
        reason: 'off by a pixel',
        by: { name: owner.name },
      },
      { decision: 'approved', snapshotNames: ['b', 'c'], reason: null },
    ])
  })
})
