import { createBuild, markFileVerified, planUploads, schema } from '@circi/db'
import {
  addTestMember,
  createTestDb,
  seedTeam,
  seedReviewRequest,
  seedUser,
  sha,
} from '@circi/testing'
import { asc, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  dismissReviewRequest,
  finalizeBuild,
  MAX_BULK_REQUEST_REVIEW,
  requestReview,
  requestReviews,
  reviewBuild,
} from '#src/index.ts'

let t: createTestDb.Result
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(async () => {
  await t.close()
})

const requestsOf = async (buildId: string) =>
  t.db
    .select()
    .from(schema.reviewRequests)
    .where(eq(schema.reviewRequests.buildId, buildId))
    .orderBy(asc(schema.reviewRequests.createdAt), asc(schema.reviewRequests.id))

/** A team whose owner asks a teammate to review a finished build with changes. */
async function setup(options: { branch?: string } = {}) {
  const { team, workspace, owner } = await seedTeam(t.db)
  const teammate = await seedUser(t.db)
  await addTestMember(t.db, { workspaceId: workspace.id, userId: teammate.id })
  const build = await createBuild(t.db, {
    teamId: team.id,
    commitSha: 'abc1234',
    branch: options.branch ?? 'feature',
  })
  await t.db
    .update(schema.builds)
    .set({ status: 'complete', conclusion: 'changes_detected' })
    .where(eq(schema.builds.id, build.id))
  return { team, workspace, owner, teammate, build }
}

/** Uploads and finalizes a new build, the way CI does, and returns it. */
async function pushBuild(teamId: string, branch: string, commit: string, hash: string) {
  const build = await createBuild(t.db, { teamId, commitSha: commit, branch })
  await planUploads(t.db, {
    buildId: build.id,
    kind: 'screenshot',
    files: [{ sha256: hash, size: 10, contentType: 'image/png' }],
    storageKeyFor: (s) => `files/${s}`,
  })
  await markFileVerified(t.db, hash, { size: 10 })
  await finalizeBuild(t.db, {
    buildId: build.id,
    screenshots: [{ name: 'home', sha256: hash }],
  })
  return build
}

describe('requestReview', () => {
  it('opens a request due when the team review target runs out', async () => {
    const { owner, teammate, build } = await setup()
    const now = new Date('2026-03-10T12:00:00.000Z')
    const { request, created } = await requestReview(t.db, {
      buildId: build.id,
      reviewerId: teammate.id,
      requestedById: owner.id,
      now,
    })
    expect(created).toBe(true)
    expect(request).toMatchObject({
      state: 'open',
      reviewerId: teammate.id,
      requestedById: owner.id,
      dueAt: new Date('2026-03-11T12:00:00.000Z'), // the default target is 24 hours
    })
  })

  it('has no due time for a team without a review target', async () => {
    const { team, owner, teammate, build } = await setup()
    await t.db
      .update(schema.teams)
      .set({ reviewTargetHours: null })
      .where(eq(schema.teams.id, team.id))
    const { request } = await requestReview(t.db, {
      buildId: build.id,
      reviewerId: teammate.id,
      requestedById: owner.id,
    })
    expect(request.dueAt).toBeNull()
  })

  it('returns the open request when asked again, whoever asks', async () => {
    const { owner, teammate, build } = await setup()
    const first = await requestReview(t.db, {
      buildId: build.id,
      reviewerId: teammate.id,
      requestedById: owner.id,
    })
    const again = await requestReview(t.db, {
      buildId: build.id,
      reviewerId: teammate.id,
      requestedById: teammate.id,
    })
    expect(again.created).toBe(false)
    expect(again.request).toEqual(first.request)
    expect(await requestsOf(build.id)).toHaveLength(1)
  })

  it('opens a new request when asked again after the first was done', async () => {
    const { owner, teammate, build } = await setup()
    const first = await requestReview(t.db, {
      buildId: build.id,
      reviewerId: teammate.id,
      requestedById: owner.id,
    })
    await reviewBuild(t.db, { buildId: build.id, userId: teammate.id, state: 'rejected' })
    const again = await requestReview(t.db, {
      buildId: build.id,
      reviewerId: teammate.id,
      requestedById: owner.id,
    })
    expect(again.created).toBe(true)
    expect(again.request.id).not.toBe(first.request.id)
    expect((await requestsOf(build.id)).map((r) => r.state).toSorted()).toEqual(['done', 'open'])
  })

  it('leaves nothing behind when the reviewer is outside the workspace', async () => {
    const { owner, build } = await setup()
    const stranger = await seedUser(t.db)
    await expect(
      requestReview(t.db, { buildId: build.id, reviewerId: stranger.id, requestedById: owner.id }),
    ).rejects.toThrow(/not a member/)
    expect(await requestsOf(build.id)).toEqual([])
  })

  it('refuses a build with no changes to review', async () => {
    const { owner, teammate, build } = await setup()
    await t.db
      .update(schema.builds)
      .set({ conclusion: 'no_changes' })
      .where(eq(schema.builds.id, build.id))
    await expect(
      requestReview(t.db, { buildId: build.id, reviewerId: teammate.id, requestedById: owner.id }),
    ).rejects.toThrow(/no changes/)
    expect(await requestsOf(build.id)).toEqual([])
  })
})

async function several() {
  const { team, owner, teammate, build } = await setup()
  const second = await createBuild(t.db, { teamId: team.id, commitSha: 'def5678', branch: 'x' })
  await t.db
    .update(schema.builds)
    .set({ status: 'complete', conclusion: 'changes_detected' })
    .where(eq(schema.builds.id, second.id))
  await t.db.delete(schema.notifications)
  return { team, owner, teammate, builds: [build, second] }
}
const notices = () => t.db.select().from(schema.notifications)

describe('requestReviews', () => {
  it('asks every reviewer about every build in one go, notifying each new request', async () => {
    const { team, owner, teammate, builds } = await several()
    const result = await requestReviews(t.db, {
      teamId: team.id,
      buildIds: builds.map((b) => b.id),
      reviewerIds: [teammate.id, owner.id],
      requestedById: owner.id,
    })
    expect(result.requests).toHaveLength(4)
    expect(result.requests.every((r) => r.created)).toBe(true)
    expect((await Promise.all(builds.map((b) => requestsOf(b.id)))).map((r) => r.length)).toEqual([
      2, 2,
    ])
    expect((await notices()).filter((n) => n.userId === teammate.id)).toHaveLength(2)

    const again = await requestReviews(t.db, {
      teamId: team.id,
      buildIds: builds.map((b) => b.id),
      reviewerIds: [teammate.id],
      requestedById: owner.id,
    })
    expect(again.requests.map((r) => r.created)).toEqual([false, false])
    expect((await notices()).filter((n) => n.userId === teammate.id)).toHaveLength(2)
  })

  it('changes nothing when one build is another team’s', async () => {
    const { team, owner, teammate, builds } = await several()
    const other = await seedTeam(t.db)
    const foreign = await createBuild(t.db, {
      teamId: other.team.id,
      commitSha: 'fff9999',
      branch: 'x',
    })
    await expect(
      requestReviews(t.db, {
        teamId: team.id,
        buildIds: [...builds.map((b) => b.id), foreign.id],
        reviewerIds: [teammate.id],
        requestedById: owner.id,
      }),
    ).rejects.toThrow('Build not found')
    expect(await Promise.all(builds.map((b) => requestsOf(b.id)))).toEqual([[], []])
    expect(await notices()).toEqual([])
  })

  it('rolls back the earlier requests when a later pair cannot be asked', async () => {
    const { team, owner, teammate, builds } = await several()
    const stranger = await seedUser(t.db)
    await expect(
      requestReviews(t.db, {
        teamId: team.id,
        buildIds: builds.map((b) => b.id),
        reviewerIds: [teammate.id, stranger.id],
        requestedById: owner.id,
      }),
    ).rejects.toThrow(/not a member/)
    expect(await Promise.all(builds.map((b) => requestsOf(b.id)))).toEqual([[], []])
    expect(await notices()).toEqual([])
  })

  it('refuses empty lists and too many builds', async () => {
    const { team, owner, teammate, builds } = await several()
    const base = { teamId: team.id, requestedById: owner.id }
    await expect(
      requestReviews(t.db, { ...base, buildIds: [], reviewerIds: [teammate.id] }),
    ).rejects.toThrow('at least one build')
    await expect(
      requestReviews(t.db, { ...base, buildIds: [builds[0]!.id], reviewerIds: [] }),
    ).rejects.toThrow('at least one reviewer')
    const many = Array.from({ length: MAX_BULK_REQUEST_REVIEW + 1 }, (_, i) => String(i))
    await expect(
      requestReviews(t.db, { ...base, buildIds: many, reviewerIds: [teammate.id] }),
    ).rejects.toThrow('at most')
  })
})

describe('a newer build on the branch', () => {
  it('supersedes the open requests of older builds on that branch, and only those', async () => {
    const { team, owner, teammate } = await setup()
    const older = await pushBuild(team.id, 'feature', 'a000001', sha('1'))
    const sameCommitOtherBranch = await pushBuild(team.id, 'other', 'a000002', sha('2'))
    await Promise.all(
      [older, sameCommitOtherBranch].map(async (b) => {
        await t.db
          .update(schema.builds)
          .set({ status: 'complete', conclusion: 'changes_detected' })
          .where(eq(schema.builds.id, b.id))
        await requestReview(t.db, {
          buildId: b.id,
          reviewerId: teammate.id,
          requestedById: owner.id,
        })
      }),
    )
    const done = await seedReviewRequest(t.db, {
      buildId: older.id,
      reviewerId: owner.id,
      state: 'done',
    })

    const newer = await pushBuild(team.id, 'feature', 'a000003', sha('3'))

    expect((await requestsOf(older.id)).map((r) => r.state).toSorted()).toEqual([
      'done',
      'superseded',
    ])
    expect((await requestsOf(older.id)).find((r) => r.id === done.id)?.state).toBe('done')
    expect((await requestsOf(sameCommitOtherBranch.id)).map((r) => r.state)).toEqual(['open'])
    expect((await requestsOf(newer.id)).length).toBe(0)
    expect(
      (await requestsOf(older.id)).find((r) => r.state === 'superseded')?.closedAt,
    ).toBeInstanceOf(Date)
  })

  it('does not supersede anything while the build is still waiting for shards', async () => {
    const { team, owner, teammate, build } = await setup({ branch: 'feature' })
    await requestReview(t.db, {
      buildId: build.id,
      reviewerId: teammate.id,
      requestedById: owner.id,
    })
    const waiting = await createBuild(t.db, {
      teamId: team.id,
      commitSha: 'b000001',
      branch: 'feature',
      parallel: { nonce: 'n', total: 2 },
    })
    await planUploads(t.db, {
      buildId: waiting.id,
      kind: 'screenshot',
      files: [{ sha256: sha('4'), size: 10, contentType: 'image/png' }],
      storageKeyFor: (s) => `files/${s}`,
    })
    await markFileVerified(t.db, sha('4'), { size: 10 })
    await finalizeBuild(t.db, {
      buildId: waiting.id,
      shardIndex: '0',
      screenshots: [{ name: 'home', sha256: sha('4') }],
    })
    expect((await requestsOf(build.id)).map((r) => r.state)).toEqual(['open'])
  })
})

describe('reviewBuild', () => {
  it('closes the build’s open requests as done when it is approved', async () => {
    const { owner, teammate, build } = await setup()
    await requestReview(t.db, {
      buildId: build.id,
      reviewerId: teammate.id,
      requestedById: owner.id,
    })
    await requestReview(t.db, { buildId: build.id, reviewerId: owner.id, requestedById: owner.id })

    await reviewBuild(t.db, { buildId: build.id, userId: teammate.id, state: 'approved' })

    const rows = await requestsOf(build.id)
    expect(rows.map((r) => r.state)).toEqual(['done', 'done'])
    expect(rows.every((r) => r.closedAt instanceof Date)).toBe(true)
  })

  it('leaves the requests open when the review itself fails', async () => {
    const { owner, teammate, build } = await setup()
    await requestReview(t.db, {
      buildId: build.id,
      reviewerId: teammate.id,
      requestedById: owner.id,
    })
    await t.db
      .update(schema.builds)
      .set({ status: 'processing' })
      .where(eq(schema.builds.id, build.id))
    await expect(
      reviewBuild(t.db, { buildId: build.id, userId: teammate.id, state: 'approved' }),
    ).rejects.toThrow(/can be reviewed once/)
    expect((await requestsOf(build.id)).map((r) => r.state)).toEqual(['open'])
  })
})

describe('dismissReviewRequest', () => {
  it('lets the reviewer or the requester drop an open request, and nobody else', async () => {
    const { team, owner, teammate, build } = await setup()
    const bystander = await seedUser(t.db)
    const { request } = await requestReview(t.db, {
      buildId: build.id,
      reviewerId: teammate.id,
      requestedById: owner.id,
    })
    const ask = { teamId: team.id, requestId: request.id }
    expect(await dismissReviewRequest(t.db, { ...ask, userId: bystander.id })).toBeUndefined()
    expect(
      await dismissReviewRequest(t.db, {
        teamId: (await seedTeam(t.db)).team.id,
        requestId: request.id,
        userId: teammate.id,
      }),
    ).toBeUndefined()
    expect(await dismissReviewRequest(t.db, { ...ask, userId: teammate.id })).toMatchObject({
      state: 'dismissed',
    })
    expect(await dismissReviewRequest(t.db, { ...ask, userId: owner.id })).toBeUndefined()
    expect((await requestsOf(build.id)).map((r) => r.state)).toEqual(['dismissed'])
  })
})
