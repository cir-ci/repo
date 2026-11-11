import { ValidationError } from '@circi/core'
import { createBuild, markFileVerified, planUploads } from '@circi/db/repositories'
import * as schema from '@circi/db/schema'
import {
  addTestMember,
  createTestDb,
  seedProject,
  seedReviewRequest,
  seedUser,
  seedChangedSnapshots,
} from '@circi/db/testing'
import { fakeSha } from '@circi/testing'
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

/** A project whose owner asks a teammate to review a finished build with changes. */
async function setup(options: { branch?: string } = {}) {
  const { project, workspace, owner } = await seedProject(t.db)
  const teammate = await seedUser(t.db)
  await addTestMember(t.db, { workspaceId: workspace.id, userId: teammate.id })
  const build = await createBuild(t.db, {
    projectId: project.id,
    commitSha: 'abc1234',
    branch: options.branch ?? 'feature',
  })
  await t.db
    .update(schema.builds)
    .set({ status: 'complete', conclusion: 'changes_detected' })
    .where(eq(schema.builds.id, build.id))
  await seedChangedSnapshots(t.db, build.id)
  return { project, workspace, owner, teammate, build }
}

/** Uploads and finalizes a new build, the way CI does, and returns it. */
async function pushBuild(projectId: string, branch: string, commit: string, hash: string) {
  const build = await createBuild(t.db, { projectId, commitSha: commit, branch })
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
  it('refuses a request from yourself with a validation error', async () => {
    const { owner, build } = await setup()
    await expect(
      requestReview(t.db, { buildId: build.id, reviewerId: owner.id, requestedById: owner.id }),
    ).rejects.toBeInstanceOf(ValidationError)
    expect(await requestsOf(build.id)).toEqual([])
  })

  it('opens a request due when the project review target runs out', async () => {
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

  it('keeps the names of the reviewer and of who asked on the request', async () => {
    const { owner, teammate, build } = await setup()
    const { request } = await requestReview(t.db, {
      buildId: build.id,
      reviewerId: teammate.id,
      requestedById: owner.id,
    })
    const [ids] = await t.db
      .select({ owner: schema.user.name })
      .from(schema.user)
      .where(eq(schema.user.id, owner.id))
    const [mate] = await t.db
      .select({ name: schema.user.name })
      .from(schema.user)
      .where(eq(schema.user.id, teammate.id))
    expect(request.requestedByName).toBe(ids?.owner)
    expect(request.reviewerName).toBe(mate?.name)

    // A later rename doesn't rewrite what was kept; a deleted asker leaves the name behind.
    await t.db.update(schema.user).set({ name: 'Renamed' }).where(eq(schema.user.id, owner.id))
    await t.db.delete(schema.user).where(eq(schema.user.id, owner.id))
    const [row] = await requestsOf(build.id)
    expect(row?.requestedById).toBeNull()
    expect(row?.requestedByName).toBe(ids?.owner)
  })

  it('has no due time for a project without a review target', async () => {
    const { project, owner, teammate, build } = await setup()
    await t.db
      .update(schema.projects)
      .set({ reviewTargetHours: null })
      .where(eq(schema.projects.id, project.id))
    const { request } = await requestReview(t.db, {
      buildId: build.id,
      reviewerId: teammate.id,
      requestedById: owner.id,
    })
    expect(request.dueAt).toBeNull()
  })

  it('returns the open request when asked again, whoever asks', async () => {
    const { owner, workspace, teammate, build } = await setup()
    const third = await seedUser(t.db)
    await addTestMember(t.db, { workspaceId: workspace.id, userId: third.id })
    const first = await requestReview(t.db, {
      buildId: build.id,
      reviewerId: teammate.id,
      requestedById: owner.id,
    })
    const again = await requestReview(t.db, {
      buildId: build.id,
      reviewerId: teammate.id,
      requestedById: third.id,
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
    ).rejects.toThrow(/must be a member of this project/)
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
  const { project, workspace, owner, teammate, build } = await setup()
  const second = await createBuild(t.db, {
    projectId: project.id,
    commitSha: 'def5678',
    branch: 'x',
  })
  await t.db
    .update(schema.builds)
    .set({ status: 'complete', conclusion: 'changes_detected' })
    .where(eq(schema.builds.id, second.id))
  await seedChangedSnapshots(t.db, second.id)
  await t.db.delete(schema.notifications)
  const third = await seedUser(t.db)
  await addTestMember(t.db, { workspaceId: workspace.id, userId: third.id })
  return { project, owner, teammate, third, builds: [build, second] }
}
const notices = () => t.db.select().from(schema.notifications)

describe('requestReviews', () => {
  it('refuses a request from yourself, whole, changing nothing', async () => {
    const { project, owner, teammate, builds } = await several()
    await expect(
      requestReviews(t.db, {
        projectId: project.id,
        buildIds: builds.map((b) => b.id),
        reviewerIds: [teammate.id, owner.id],
        requestedById: owner.id,
      }),
    ).rejects.toThrow("You can't request a review from yourself.")
    expect((await Promise.all(builds.map((b) => requestsOf(b.id)))).flat()).toEqual([])
    expect(await notices()).toEqual([])
  })

  it('asks every reviewer about every build in one go, notifying each new request', async () => {
    const { project, owner, teammate, third, builds } = await several()
    const result = await requestReviews(t.db, {
      projectId: project.id,
      buildIds: builds.map((b) => b.id),
      reviewerIds: [teammate.id, third.id],
      requestedById: owner.id,
    })
    expect(result.requests).toHaveLength(4)
    expect(result.requests.every((r) => r.created)).toBe(true)
    expect((await Promise.all(builds.map((b) => requestsOf(b.id)))).map((r) => r.length)).toEqual([
      2, 2,
    ])
    expect((await notices()).filter((n) => n.userId === teammate.id)).toHaveLength(2)

    const again = await requestReviews(t.db, {
      projectId: project.id,
      buildIds: builds.map((b) => b.id),
      reviewerIds: [teammate.id],
      requestedById: owner.id,
    })
    expect(again.requests.map((r) => r.created)).toEqual([false, false])
    expect((await notices()).filter((n) => n.userId === teammate.id)).toHaveLength(2)
  })

  it("changes nothing when one build is another project's", async () => {
    const { project, owner, teammate, builds } = await several()
    const other = await seedProject(t.db)
    const foreign = await createBuild(t.db, {
      projectId: other.project.id,
      commitSha: 'fff9999',
      branch: 'x',
    })
    await expect(
      requestReviews(t.db, {
        projectId: project.id,
        buildIds: [...builds.map((b) => b.id), foreign.id],
        reviewerIds: [teammate.id],
        requestedById: owner.id,
      }),
    ).rejects.toThrow('Build not found')
    expect(await Promise.all(builds.map((b) => requestsOf(b.id)))).toEqual([[], []])
    expect(await notices()).toEqual([])
  })

  it('rolls back the earlier requests when a later pair cannot be asked', async () => {
    const { project, owner, teammate, builds } = await several()
    const stranger = await seedUser(t.db)
    await expect(
      requestReviews(t.db, {
        projectId: project.id,
        buildIds: builds.map((b) => b.id),
        reviewerIds: [teammate.id, stranger.id],
        requestedById: owner.id,
      }),
    ).rejects.toThrow(/must be a member of this project/)
    expect(await Promise.all(builds.map((b) => requestsOf(b.id)))).toEqual([[], []])
    expect(await notices()).toEqual([])
  })

  it('refuses empty lists and too many builds', async () => {
    const { project, owner, teammate, builds } = await several()
    const base = { projectId: project.id, requestedById: owner.id }
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
    const { project, owner, teammate } = await setup()
    const older = await pushBuild(project.id, 'feature', 'a000001', fakeSha('1'))
    const sameCommitOtherBranch = await pushBuild(project.id, 'other', 'a000002', fakeSha('2'))
    await Promise.all(
      [older, sameCommitOtherBranch].map(async (b) => {
        await t.db
          .update(schema.builds)
          .set({ status: 'complete', conclusion: 'changes_detected' })
          .where(eq(schema.builds.id, b.id))
        await seedChangedSnapshots(t.db, b.id)
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

    const newer = await pushBuild(project.id, 'feature', 'a000003', fakeSha('3'))

    expect((await requestsOf(older.id)).map((r) => r.state).toSorted()).toEqual([
      'done',
      'superseded',
    ])
    expect((await requestsOf(older.id)).find((r) => r.id === done.id)?.state).toBe('done')
    expect((await requestsOf(sameCommitOtherBranch.id)).map((r) => r.state)).toEqual(['open'])
    // The person the owner asked is asked again on the newer build (the project default).
    expect((await requestsOf(newer.id)).map((r) => [r.reviewerId, r.requestedById])).toEqual([
      [teammate.id, owner.id],
    ])
    expect(
      (await requestsOf(older.id)).find((r) => r.state === 'superseded')?.closedAt,
    ).toBeInstanceOf(Date)
  })

  it('does not supersede anything while the build is still waiting for shards', async () => {
    const { project, owner, teammate, build } = await setup({ branch: 'feature' })
    await requestReview(t.db, {
      buildId: build.id,
      reviewerId: teammate.id,
      requestedById: owner.id,
    })
    const waiting = await createBuild(t.db, {
      projectId: project.id,
      commitSha: 'b000001',
      branch: 'feature',
      parallel: { nonce: 'n', total: 2 },
    })
    await planUploads(t.db, {
      buildId: waiting.id,
      kind: 'screenshot',
      files: [{ sha256: fakeSha('4'), size: 10, contentType: 'image/png' }],
      storageKeyFor: (s) => `files/${s}`,
    })
    await markFileVerified(t.db, fakeSha('4'), { size: 10 })
    await finalizeBuild(t.db, {
      buildId: waiting.id,
      shardIndex: '0',
      screenshots: [{ name: 'home', sha256: fakeSha('4') }],
    })
    expect((await requestsOf(build.id)).map((r) => r.state)).toEqual(['open'])
  })
})

describe('reviewBuild', () => {
  it("closes the build's open requests as done when it is approved", async () => {
    const { owner, teammate, build } = await setup()
    await requestReview(t.db, {
      buildId: build.id,
      reviewerId: teammate.id,
      requestedById: owner.id,
    })
    await requestReview(t.db, {
      buildId: build.id,
      reviewerId: owner.id,
      requestedById: teammate.id,
    })

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
    const { project, owner, teammate, build } = await setup()
    const bystander = await seedUser(t.db)
    const { request } = await requestReview(t.db, {
      buildId: build.id,
      reviewerId: teammate.id,
      requestedById: owner.id,
    })
    const ask = { projectId: project.id, requestId: request.id }
    expect(await dismissReviewRequest(t.db, { ...ask, userId: bystander.id })).toBeUndefined()
    expect(
      await dismissReviewRequest(t.db, {
        projectId: (await seedProject(t.db)).project.id,
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
