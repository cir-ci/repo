import { GIT_NOTIFY_QUEUE, QUEUES } from '@circi/db/queue'
import { createBuild } from '@circi/db/repositories'
import * as schema from '@circi/db/schema'
import {
  addTestMember,
  createTestDb,
  seedChangedSnapshots,
  seedGitLink,
  seedReviewRequest,
  seedTeam,
  seedUser,
} from '@circi/db/testing'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { reviewBuild, reviewSnapshots } from '#src/index.ts'

let t: createTestDb.Result
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(async () => {
  await t.close()
})

const jobs = async (queue: string) =>
  t.db.select().from(schema.jobs).where(eq(schema.jobs.queue, queue))

/** A finished build with changes to `a`, `b` and `c`, written by `ann`, reviewed by the owner. */
async function setup() {
  const { team, workspace, owner } = await seedTeam(t.db)
  const ann = await seedUser(t.db)
  await addTestMember(t.db, { workspaceId: workspace.id, userId: ann.id })
  const build = await createBuild(t.db, {
    teamId: team.id,
    commitSha: 'abc1234',
    branch: 'feature',
    author: { login: 'ann', userId: ann.id },
  })
  await t.db
    .update(schema.builds)
    .set({ status: 'complete', conclusion: 'changes_detected' })
    .where(eq(schema.builds.id, build.id))
  await seedGitLink(t.db, team.id, { externalId: '1', repoRef: 'acme/web' })
  await seedChangedSnapshots(t.db, build.id, ['a', 'b', 'c'])
  await t.db.delete(schema.jobs)
  return { owner, ann, build }
}

const statusOf = async (id: string) =>
  (await t.db.select().from(schema.builds).where(eq(schema.builds.id, id)))[0]?.reviewStatus

describe('reviewSnapshots', () => {
  it('announces only when the derived build status moves, exactly once', async () => {
    const { owner, ann, build } = await setup()
    const decide = (decision: 'approved' | 'rejected', snapshotNames: string[]) =>
      reviewSnapshots(t.db, { buildId: build.id, userId: owner.id, decision, snapshotNames })

    await decide('approved', ['a'])
    await decide('approved', ['b'])
    expect(await statusOf(build.id)).toBe('pending')
    expect(await jobs(QUEUES.webhook)).toHaveLength(0)
    // Nothing is announced to anyone, but the pull request comment shows the per-snapshot
    // counts, so each decision refreshes it.
    expect(await jobs(GIT_NOTIFY_QUEUE)).toHaveLength(2)
    expect(await jobs(GIT_NOTIFY_QUEUE)).toSatisfy((rows: { dedupeKey: string | null }[]) =>
      rows.every((r) => r.dedupeKey?.includes(':snapshots:')),
    )
    expect(
      await t.db
        .select()
        .from(schema.notifications)
        .where(eq(schema.notifications.buildId, build.id)),
    ).toHaveLength(0)

    await decide('approved', ['c'])
    expect(await statusOf(build.id)).toBe('approved')
    expect(await jobs(GIT_NOTIFY_QUEUE)).toHaveLength(3)
    expect((await jobs(GIT_NOTIFY_QUEUE)).some((j) => j.dedupeKey?.endsWith(':approved'))).toBe(
      true,
    )
    const notices = await t.db
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.buildId, build.id))
    expect(notices.map((n) => [n.userId, n.kind])).toEqual([[ann.id, 'build_approved']])

    await decide('approved', ['c']) // repeated: nothing new
    expect(await jobs(GIT_NOTIFY_QUEUE)).toHaveLength(3)
    expect(
      await t.db
        .select()
        .from(schema.notifications)
        .where(eq(schema.notifications.buildId, build.id)),
    ).toHaveLength(1)
  })

  it('rejects on one rejection, tells the author the joined reasons, and approves after a fix', async () => {
    const { owner, ann, build } = await setup()
    await reviewSnapshots(t.db, {
      buildId: build.id,
      userId: owner.id,
      decision: 'rejected',
      snapshotNames: ['a'],
      reason: 'too wide',
    })
    await reviewSnapshots(t.db, {
      buildId: build.id,
      userId: owner.id,
      decision: 'rejected',
      snapshotNames: ['b'],
      reason: 'wrong colour',
    })
    expect(await statusOf(build.id)).toBe('rejected')
    const [notice] = await t.db
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.userId, ann.id))
    expect(notice).toMatchObject({ kind: 'build_rejected', payload: { reason: 'too wide' } })

    await reviewSnapshots(t.db, {
      buildId: build.id,
      userId: owner.id,
      decision: 'approved',
      snapshotNames: 'all',
    })
    expect(await statusOf(build.id)).toBe('approved')
  })

  it('closes review requests once the build is decided, not before', async () => {
    const { owner, ann, build } = await setup()
    const request = await seedReviewRequest(t.db, { buildId: build.id, reviewerId: ann.id })
    await reviewSnapshots(t.db, {
      buildId: build.id,
      userId: owner.id,
      decision: 'approved',
      snapshotNames: ['a'],
    })
    const open = async () =>
      (
        await t.db
          .select()
          .from(schema.reviewRequests)
          .where(eq(schema.reviewRequests.id, request.id))
      )[0]?.state
    expect(await open()).toBe('open')
    await reviewSnapshots(t.db, {
      buildId: build.id,
      userId: owner.id,
      decision: 'approved',
      snapshotNames: 'undecided',
    })
    expect(await open()).toBe('done')
  })

  it('leaves nothing behind when the transaction rolls back', async () => {
    const { owner, build } = await setup()
    await expect(
      t.db.transaction(async (tx) => {
        await reviewBuild(tx, { buildId: build.id, userId: owner.id, state: 'approved' })
        throw new Error('roll back')
      }),
    ).rejects.toThrow('roll back')
    expect(await statusOf(build.id)).toBe('pending')
    expect(
      await t.db
        .select()
        .from(schema.snapshotReviews)
        .where(eq(schema.snapshotReviews.buildId, build.id)),
    ).toHaveLength(0)
    expect(await jobs(GIT_NOTIFY_QUEUE)).toHaveLength(0)
  })
})
