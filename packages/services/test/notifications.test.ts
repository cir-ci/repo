import {
  createBuild,
  createReviewRule,
  type Database,
  markFileVerified,
  planUploads,
  QUEUES,
  schema,
  setNotificationPreferences,
} from '@circi/db'
import {
  addTestMember,
  createTestDb,
  seedNotification,
  seedTeam,
  seedUser,
  fakeSha,
  seedChangedSnapshots,
} from '@circi/testing'
import { and, asc, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  dismissReviewRequest,
  finalizeBuild,
  markInboxRead,
  markNotificationRead,
  removeNotification,
  requestReview,
  reviewBuild,
  snoozeNotification,
} from '#src/index.ts'

let t: createTestDb.Result
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(async () => {
  await t.close()
})

const noticesOf = async (userId: string, buildId?: string) =>
  t.db
    .select()
    .from(schema.notifications)
    .where(
      and(
        eq(schema.notifications.userId, userId),
        ...(buildId ? [eq(schema.notifications.buildId, buildId)] : []),
      ),
    )
    .orderBy(asc(schema.notifications.createdAt), asc(schema.notifications.id))

const emailJobs = async () =>
  t.db.select().from(schema.jobs).where(eq(schema.jobs.queue, QUEUES.notificationEmail))

/** A team with an owner, a teammate (`ann`, who wrote the build) and `bob`; a reviewable build. */
async function setup() {
  const { team, workspace, owner } = await seedTeam(t.db)
  const ann = await seedUser(t.db)
  const bob = await seedUser(t.db)
  for (const u of [ann, bob]) {
    // oxlint-disable-next-line no-await-in-loop -- tiny fixed list
    await addTestMember(t.db, { workspaceId: workspace.id, userId: u.id })
  }
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
  await seedChangedSnapshots(t.db, build.id)
  return { team, workspace, owner, ann, bob, build }
}

let n = 0
async function upload(db: Database, teamId: string, branch: string) {
  n += 1
  const hash = fakeSha(n.toString(16).padStart(2, '0'))
  const build = await createBuild(db, {
    teamId,
    commitSha: `def${String(n).padStart(4, '0')}`,
    branch,
  })
  await planUploads(db, {
    buildId: build.id,
    kind: 'screenshot',
    files: [{ sha256: hash, size: 10, contentType: 'image/png' }],
    storageKeyFor: (s) => `files/${s}`,
  })
  await markFileVerified(db, hash, { size: 10 })
  await finalizeBuild(db, { buildId: build.id, screenshots: [{ name: 'home', sha256: hash }] })
  return build
}

describe('review requested', () => {
  it('notifies the reviewer, naming who asked, and queues an email', async () => {
    const { owner, bob, build } = await setup()
    const { request } = await requestReview(t.db, {
      buildId: build.id,
      reviewerId: bob.id,
      requestedById: owner.id,
    })
    const [notice, ...rest] = await noticesOf(bob.id)
    expect(rest).toEqual([])
    expect(notice).toMatchObject({
      kind: 'review_requested',
      buildId: build.id,
      actorId: owner.id,
      readAt: null,
    })
    expect(notice?.payload).toEqual({ dueAt: request.dueAt?.toISOString() })
    const jobs = await emailJobs()
    expect(jobs.some((j) => j.payload.notificationId === notice?.id)).toBe(true)
  })

  it('does not notify twice for a request that is already open, nor for asking yourself', async () => {
    const { owner, bob, build } = await setup()
    const ask = () =>
      requestReview(t.db, { buildId: build.id, reviewerId: bob.id, requestedById: owner.id })
    await ask()
    await ask()
    expect(await noticesOf(bob.id)).toHaveLength(1)
    await requestReview(t.db, { buildId: build.id, reviewerId: owner.id, requestedById: owner.id })
    expect(await noticesOf(owner.id)).toEqual([])
  })

  it('is a re-request when the reviewer had a request that closed', async () => {
    const { owner, bob, build } = await setup()
    const ask = () =>
      requestReview(t.db, { buildId: build.id, reviewerId: bob.id, requestedById: owner.id })
    await ask()
    await reviewBuild(t.db, { buildId: build.id, userId: bob.id, state: 'rejected' })
    await ask()
    expect((await noticesOf(bob.id)).map((x) => x.kind)).toEqual([
      'review_requested',
      'review_re_requested',
    ])
  })

  it('leaves nothing behind when the transaction rolls back', async () => {
    const { owner, bob, build } = await setup()
    await expect(
      t.db.transaction(async (tx) => {
        await requestReview(tx, { buildId: build.id, reviewerId: bob.id, requestedById: owner.id })
        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')
    expect(await noticesOf(bob.id)).toEqual([])
  })

  it('leaves nothing behind when the request itself fails', async () => {
    const { owner, build } = await setup()
    const stranger = await seedUser(t.db)
    await expect(
      requestReview(t.db, { buildId: build.id, reviewerId: stranger.id, requestedById: owner.id }),
    ).rejects.toThrow(/not a member/)
    expect(await noticesOf(stranger.id)).toEqual([])
  })

  it('queues no email for a person who turned it off, but still notifies them', async () => {
    const { owner, bob, build } = await setup()
    await setNotificationPreferences(t.db, bob.id, { emailReviewRequested: false })
    await requestReview(t.db, { buildId: build.id, reviewerId: bob.id, requestedById: owner.id })
    const [notice] = await noticesOf(bob.id)
    expect(notice).toBeDefined()
    expect((await emailJobs()).some((j) => j.payload.notificationId === notice?.id)).toBe(false)
  })
})

describe('review rules and the rotation', () => {
  it('notifies the rule reviewer when the build is finalized, with no actor', async () => {
    const { team, bob } = await setup()
    await createReviewRule(t.db, {
      teamId: team.id,
      kind: 'snapshot-name',
      pattern: 'home',
      reviewerIds: [bob.id],
    })
    const build = await upload(t.db, team.id, 'rules-branch')
    const [notice, ...rest] = await noticesOf(bob.id, build.id)
    expect(rest).toEqual([])
    expect(notice).toMatchObject({ kind: 'review_requested', actorId: null })
  })

  it('clears the request notice when a newer build supersedes the request', async () => {
    const { team, bob } = await setup()
    await createReviewRule(t.db, {
      teamId: team.id,
      kind: 'snapshot-name',
      pattern: 'home',
      reviewerIds: [bob.id],
    })
    const first = await upload(t.db, team.id, 'super-branch')
    await upload(t.db, team.id, 'super-branch')
    const [old] = await noticesOf(bob.id, first.id)
    expect(old?.readAt).not.toBeNull()
  })
})

describe('build approved or rejected', () => {
  it('tells the author, with the reject reason', async () => {
    const { owner, ann, build } = await setup()
    await reviewBuild(t.db, {
      buildId: build.id,
      userId: owner.id,
      state: 'rejected',
      reason: 'The header is clipped',
    })
    await reviewBuild(t.db, { buildId: build.id, userId: owner.id, state: 'approved' })
    const notices = await noticesOf(ann.id)
    expect(notices.map((x) => [x.kind, x.actorId, x.payload])).toEqual([
      ['build_rejected', owner.id, { reason: 'The header is clipped' }],
      ['build_approved', owner.id, {}],
    ])
  })

  it('does not notify again for an unchanged decision, nor the author who reviews their own build', async () => {
    const { owner, ann, build } = await setup()
    await reviewBuild(t.db, { buildId: build.id, userId: owner.id, state: 'approved' })
    await reviewBuild(t.db, { buildId: build.id, userId: owner.id, state: 'approved' })
    expect(await noticesOf(ann.id)).toHaveLength(1)

    const own = await setup()
    await reviewBuild(t.db, { buildId: own.build.id, userId: own.ann.id, state: 'rejected' })
    expect(await noticesOf(own.ann.id)).toEqual([])
  })

  it('has nobody to tell when the build has no known author', async () => {
    const { team, owner } = await seedTeam(t.db)
    const build = await createBuild(t.db, {
      teamId: team.id,
      commitSha: 'abc9999',
      branch: 'x',
    })
    await t.db
      .update(schema.builds)
      .set({ status: 'complete', conclusion: 'changes_detected' })
      .where(eq(schema.builds.id, build.id))
    await seedChangedSnapshots(t.db, build.id)
    await reviewBuild(t.db, { buildId: build.id, userId: owner.id, state: 'approved' })
    expect(
      await t.db
        .select()
        .from(schema.notifications)
        .where(eq(schema.notifications.buildId, build.id)),
    ).toEqual([])
  })

  it('writes no notification when the review fails', async () => {
    const { owner, ann } = await setup()
    const pending = await createBuild(t.db, {
      teamId: (await seedTeam(t.db)).team.id,
      commitSha: 'abc8888',
      author: { userId: ann.id },
    })
    await expect(
      reviewBuild(t.db, { buildId: pending.id, userId: owner.id, state: 'approved' }),
    ).rejects.toThrow(/complete/)
    expect(await noticesOf(ann.id, pending.id)).toEqual([])
  })
})

describe('cross-clearing', () => {
  it("marks the reviewer's notifications about the build read when they review it", async () => {
    const { owner, bob, build } = await setup()
    await requestReview(t.db, { buildId: build.id, reviewerId: bob.id, requestedById: owner.id })
    const other = await seedNotification(t.db, { userId: bob.id, kind: 'mentioned' })
    await reviewBuild(t.db, { buildId: build.id, userId: bob.id, state: 'approved' })
    const notices = await noticesOf(bob.id, build.id)
    expect(notices).toHaveLength(1)
    expect(notices[0]?.readAt).not.toBeNull()
    // Something about another build stays unread.
    expect((await noticesOf(bob.id)).find((x) => x.id === other.id)?.readAt).toBeNull()
  })

  it("clears the other reviewers' request notices when the build is decided", async () => {
    const { owner, ann, bob, build } = await setup()
    await requestReview(t.db, { buildId: build.id, reviewerId: bob.id, requestedById: owner.id })
    await reviewBuild(t.db, { buildId: build.id, userId: ann.id, state: 'approved' })
    expect((await noticesOf(bob.id, build.id))[0]?.readAt).not.toBeNull()
  })

  it('clears the notice when the request is dismissed', async () => {
    const { team, owner, bob, build } = await setup()
    const { request } = await requestReview(t.db, {
      buildId: build.id,
      reviewerId: bob.id,
      requestedById: owner.id,
    })
    await dismissReviewRequest(t.db, {
      teamId: team.id,
      requestId: request.id,
      userId: bob.id,
    })
    expect((await noticesOf(bob.id, build.id))[0]?.readAt).not.toBeNull()
  })

  it('closes the request when the build is decided from the inbox (the same reviewBuild)', async () => {
    const { owner, bob, build } = await setup()
    await requestReview(t.db, { buildId: build.id, reviewerId: bob.id, requestedById: owner.id })
    await reviewBuild(t.db, { buildId: build.id, userId: bob.id, state: 'rejected', source: 'ui' })
    const [request] = await t.db
      .select()
      .from(schema.reviewRequests)
      .where(eq(schema.reviewRequests.buildId, build.id))
    expect(request?.state).toBe('done')
  })
})

describe('what a person does with their inbox', () => {
  it('reads, snoozes and deletes only their own notifications', async () => {
    const { ann, bob } = await setup()
    const mine = await seedNotification(t.db, { userId: ann.id })
    const now = new Date('2026-03-11T15:00:00Z')

    expect(
      (await markNotificationRead(t.db, { userId: ann.id, id: mine.id, read: true })).readAt,
    ).not.toBeNull()
    expect(
      (await markNotificationRead(t.db, { userId: ann.id, id: mine.id, read: false })).readAt,
    ).toBeNull()
    expect(
      (await snoozeNotification(t.db, { userId: ann.id, id: mine.id, choice: 'tomorrow', now }))
        .snoozedUntil,
    ).toEqual(new Date('2026-03-12T09:00:00Z'))

    await expect(
      markNotificationRead(t.db, { userId: bob.id, id: mine.id, read: true }),
    ).rejects.toThrow(/not found/)
    await expect(removeNotification(t.db, { userId: bob.id, id: mine.id })).rejects.toThrow(
      /not found/,
    )
    await removeNotification(t.db, { userId: ann.id, id: mine.id })
    await expect(removeNotification(t.db, { userId: ann.id, id: mine.id })).rejects.toThrow(
      /not found/,
    )
  })

  it('marks everything read, for that user only', async () => {
    const { ann, bob } = await setup()
    await seedNotification(t.db, { userId: ann.id })
    await seedNotification(t.db, { userId: ann.id, kind: 'mentioned' })
    const bobs = await seedNotification(t.db, { userId: bob.id })
    expect(await markInboxRead(t.db, ann.id)).toBeGreaterThanOrEqual(2)
    expect((await noticesOf(ann.id)).every((x) => x.readAt !== null)).toBe(true)
    expect((await noticesOf(bob.id)).find((x) => x.id === bobs.id)?.readAt).toBeNull()
  })
})
