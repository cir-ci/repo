import { resolveBaseline } from '@circi/core'
import { createTestDb, seedChangedSnapshots, seedTeam, seedUser } from '@circi/db/testing'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { ConflictError, NotFoundError } from '#src/index.ts'
import { listBuildReviews, listSnapshotReviews } from '#src/queries/index.ts'
import {
  createBuild,
  listBaselineCandidates,
  recordReview,
  recordSnapshotReviews,
} from '#src/repositories/index.ts'
import * as schema from '#src/schema/index.ts'

let t: createTestDb.Result

beforeAll(async () => {
  t = await createTestDb()
})
afterAll(async () => {
  await t.close()
})

/** A build as the worker leaves it: complete, with changes, waiting for a decision. */
async function buildWithChanges(
  overrides: Partial<typeof schema.builds.$inferInsert> = {},
  snapshots = ['home'],
) {
  const { team, owner } = await seedTeam(t.db)
  const build = await createBuild(t.db, {
    teamId: team.id,
    commitSha: 'abc1234',
    branch: 'feature',
  })
  await t.db
    .update(schema.builds)
    .set({ status: 'complete', conclusion: 'changes_detected', ...overrides })
    .where(eq(schema.builds.id, build.id))
  await seedChangedSnapshots(t.db, build.id, snapshots)
  return { team, owner, buildId: build.id }
}

/** The decision's effect on the build; announcing it is the service layer's job. */
const reviewBuild = async (db: createTestDb.Result['db'], input: recordReview.Input) =>
  (await recordReview(db, input)).build

describe('recordReview', () => {
  it('approves a build, and records who and how', async () => {
    const { owner, buildId } = await buildWithChanges()
    const build = await reviewBuild(t.db, { buildId, userId: owner.id, state: 'approved' })
    expect(build.reviewStatus).toBe('approved')
    expect(await listBuildReviews(t.db, buildId)).toEqual([
      {
        state: 'approved',
        source: 'ui',
        reason: null,
        userName: owner.name,
        createdAt: expect.any(Date),
      },
    ])
  })

  it('lets the latest decision win, keeping the history newest first', async () => {
    const { owner, buildId } = await buildWithChanges()
    const other = await seedUser(t.db)
    await reviewBuild(t.db, { buildId, userId: owner.id, state: 'rejected' })
    const final = await reviewBuild(t.db, { buildId, userId: other.id, state: 'approved' })
    expect(final.reviewStatus).toBe('approved')
    const history = await listBuildReviews(t.db, buildId)
    expect(history.map((r) => [r.state, r.userName])).toEqual([
      ['approved', other.name],
      ['rejected', owner.name],
    ])
  })

  it('does nothing when the decision is already the current one', async () => {
    const { owner, buildId } = await buildWithChanges()
    await reviewBuild(t.db, { buildId, userId: owner.id, state: 'approved' })
    await reviewBuild(t.db, { buildId, userId: owner.id, state: 'approved' })
    expect(await listBuildReviews(t.db, buildId)).toHaveLength(1)
  })

  it('refuses a build that is still processing', async () => {
    const { owner, buildId } = await buildWithChanges({ status: 'processing', conclusion: null })
    await expect(
      reviewBuild(t.db, { buildId, userId: owner.id, state: 'approved' }),
    ).rejects.toThrow(/is processing/)
  })

  it('refuses a build with no changes, and a build that does not exist', async () => {
    const { owner, buildId } = await buildWithChanges({ conclusion: 'no_changes' })
    await expect(
      reviewBuild(t.db, { buildId, userId: owner.id, state: 'approved' }),
    ).rejects.toBeInstanceOf(ConflictError)
    await expect(
      reviewBuild(t.db, {
        buildId: '00000000-0000-0000-0000-000000000000',
        userId: owner.id,
        state: 'approved',
      }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it('keeps the decision when the reviewer’s account is deleted', async () => {
    const { buildId } = await buildWithChanges()
    const leaver = await seedUser(t.db)
    await reviewBuild(t.db, { buildId, userId: leaver.id, state: 'rejected' })
    await t.db.delete(schema.user).where(eq(schema.user.id, leaver.id))
    expect(await listBuildReviews(t.db, buildId)).toMatchObject([
      { state: 'rejected', userName: null },
    ])
  })
})

const decide = (
  buildId: string,
  userId: string,
  decision: 'approved' | 'rejected',
  snapshotNames: recordSnapshotReviews.Input['snapshotNames'],
  reason?: string,
) =>
  recordSnapshotReviews(t.db, {
    buildId,
    userId,
    decision,
    snapshotNames,
    ...(reason ? { reason } : {}),
  })

describe('recordSnapshotReviews', () => {
  it('derives the build status: pending until every changed snapshot is approved', async () => {
    const { owner, buildId } = await buildWithChanges({}, ['a', 'b'])
    const first = await decide(buildId, owner.id, 'approved', ['a'])
    expect(first).toMatchObject({
      changed: false,
      decided: ['a'],
      build: { reviewStatus: 'pending' },
    })
    const second = await decide(buildId, owner.id, 'approved', ['b'])
    expect(second).toMatchObject({ changed: true, build: { reviewStatus: 'approved' } })
    expect(await listBuildReviews(t.db, buildId)).toHaveLength(1)
  })

  it('rejects the build on any rejection, and approves again once that snapshot is approved', async () => {
    const { owner, buildId } = await buildWithChanges({}, ['a', 'b'])
    await decide(buildId, owner.id, 'approved', ['a'])
    const rejected = await decide(buildId, owner.id, 'rejected', ['b'], 'too wide')
    expect(rejected).toMatchObject({
      changed: true,
      reasons: ['too wide'],
      build: { reviewStatus: 'rejected' },
    })
    const fixed = await decide(buildId, owner.id, 'approved', ['b'])
    expect(fixed).toMatchObject({
      changed: true,
      previousStatus: 'rejected',
      build: { reviewStatus: 'approved' },
    })
    // The rejection stays in the timeline; only the latest decision is current.
    const rows = await t.db
      .select()
      .from(schema.snapshotReviews)
      .where(eq(schema.snapshotReviews.buildId, buildId))
    expect(rows).toHaveLength(3)
    expect((await listSnapshotReviews(t.db, buildId)).map((r) => [r.name, r.decision])).toEqual([
      ['a', 'approved'],
      ['b', 'approved'],
    ])
  })

  it('approves every undecided snapshot and is idempotent, leaving a rejection alone', async () => {
    const { owner, buildId } = await buildWithChanges({}, ['a', 'b', 'c'])
    await decide(buildId, owner.id, 'rejected', ['a'])
    const some = await decide(buildId, owner.id, 'approved', 'undecided')
    expect(some).toMatchObject({ decided: ['b', 'c'], build: { reviewStatus: 'rejected' } })
    const again = await decide(buildId, owner.id, 'approved', 'undecided')
    expect(again).toMatchObject({ changed: false, decided: [] })
  })

  it('refuses a snapshot that did not change', async () => {
    const { owner, buildId } = await buildWithChanges({}, ['a'])
    await expect(decide(buildId, owner.id, 'approved', ['nope'])).rejects.toBeInstanceOf(
      ConflictError,
    )
  })
})

describe('what a decision changes for later builds', () => {
  it('turns an approved build into a baseline, and a rejected one stays out', async () => {
    const { team, owner, buildId } = await buildWithChanges({ branch: 'main' })
    const next = await createBuild(t.db, {
      teamId: team.id,
      commitSha: 'def5678',
      branch: 'main',
    })
    const pick = async () => {
      const build = await t.db.query.builds.findFirst({
        where: (b, { eq: is }) => is(b.id, next.id),
      })
      if (!build) throw new Error('missing build')
      const candidates = await listBaselineCandidates(t.db, { ...build, ancestorShas: ['abc1234'] })
      return resolveBaseline({ ancestorShas: ['abc1234'], defaultBranch: 'main' }, candidates)
    }

    expect(await pick()).toEqual({ via: 'none' }) // changes, undecided: not a baseline yet
    await reviewBuild(t.db, { buildId, userId: owner.id, state: 'approved' })
    expect(await pick()).toMatchObject({ via: 'ancestry', build: { id: buildId } })
    await reviewBuild(t.db, { buildId, userId: owner.id, state: 'rejected' })
    expect(await pick()).toEqual({ via: 'none' })
  })
})
