import {
  createBuild,
  createIntegration,
  QUEUES,
  schema,
  setIntegrationAttention,
  setIntegrationProject,
} from '@circi/db'
import { addTestMember, createTestDb, seedProject, seedUser } from '@circi/testing'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { notifyOverdueReviews, requestReview, reviewBuild } from '#src/index.ts'

let t: createTestDb.Result
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(async () => {
  await t.close()
})

const slackJobs = () =>
  t.db
    .select()
    .from(schema.jobs)
    .where(eq(schema.jobs.queue, QUEUES.slack))
    .then((rows) => rows.map((r) => r.payload))

async function setup(options: { events?: string[] } = {}) {
  await t.db.delete(schema.jobs)
  const { project, org, owner } = await seedProject(t.db)
  const reviewer = await seedUser(t.db)
  await addTestMember(t.db, { orgId: org.id, userId: reviewer.id })
  const build = await createBuild(t.db, {
    projectId: project.id,
    commitSha: 'abc1234',
    branch: 'f',
  })
  await t.db
    .update(schema.builds)
    .set({ status: 'complete', conclusion: 'changes_detected' })
    .where(eq(schema.builds.id, build.id))
  const integration = await createIntegration(t.db, {
    orgId: org.id,
    kind: 'slack',
    displayName: 'Acme',
    externalId: `T${Math.random().toString(36).slice(2, 8)}`,
    encryptedCredentials: 'sealed',
  })
  await setIntegrationProject(t.db, {
    integrationId: integration.id,
    projectId: project.id,
    externalRef: 'C1',
    extra: { name: 'reviews', ...(options.events ? { events: options.events } : {}) },
  })
  return { project, owner, reviewer, build, integration }
}

describe('slack notices (outbox)', () => {
  it('queues one job per channel when a rejection commits, with the reason', async () => {
    const { owner, build, integration } = await setup()
    await reviewBuild(t.db, {
      buildId: build.id,
      userId: owner.id,
      state: 'rejected',
      reason: 'bad',
    })
    expect(await slackJobs()).toEqual([
      expect.objectContaining({
        event: 'build_rejected',
        integrationId: integration.id,
        buildId: build.id,
        reviewerId: owner.id,
        reason: 'bad',
      }),
    ])
  })

  it('queues nothing when the transaction rolls back', async () => {
    const { owner, reviewer, build } = await setup()
    await expect(
      t.db.transaction(async (tx) => {
        await requestReview(tx, {
          buildId: build.id,
          reviewerId: reviewer.id,
          requestedById: owner.id,
        })
        await reviewBuild(tx, { buildId: build.id, userId: owner.id, state: 'rejected' })
        expect(
          await tx.select().from(schema.jobs).where(eq(schema.jobs.queue, QUEUES.slack)),
        ).toHaveLength(2)
        throw new Error('roll back')
      }),
    ).rejects.toThrow('roll back')
    expect(await slackJobs()).toEqual([])
  })

  it('queues nothing when the decision changed nothing, or the event is not listed', async () => {
    const { owner, reviewer, build } = await setup({ events: ['review_overdue'] })
    await reviewBuild(t.db, { buildId: build.id, userId: owner.id, state: 'rejected' })
    await requestReview(t.db, {
      buildId: build.id,
      reviewerId: reviewer.id,
      requestedById: owner.id,
    })
    expect(await slackJobs()).toEqual([])
  })

  it('queues review requested for a new request only, and overdue once', async () => {
    const { owner, reviewer, build } = await setup()
    const dueAt = new Date('2026-03-10T12:00:00Z')
    const first = await requestReview(t.db, {
      buildId: build.id,
      reviewerId: reviewer.id,
      requestedById: owner.id,
      now: new Date(dueAt.getTime() - 3600_000),
    })
    // Asking again while the request is open returns it unchanged and tells nobody twice.
    await requestReview(t.db, {
      buildId: build.id,
      reviewerId: reviewer.id,
      requestedById: owner.id,
    })
    expect(first.created).toBe(true)
    expect((await slackJobs()).map((j) => j.event)).toEqual(['review_requested'])
    await t.db
      .update(schema.reviewRequests)
      .set({ dueAt })
      .where(eq(schema.reviewRequests.id, first.request.id))
    await notifyOverdueReviews(t.db, { now: new Date(dueAt.getTime() + 60_000) })
    await notifyOverdueReviews(t.db, { now: new Date(dueAt.getTime() + 120_000) })
    expect((await slackJobs()).map((j) => j.event)).toEqual(['review_requested', 'review_overdue'])
  })

  it('skips an integration that needs attention', async () => {
    const { owner, build, integration } = await setup()
    await setIntegrationAttention(t.db, integration.id, 'token_revoked')
    await reviewBuild(t.db, { buildId: build.id, userId: owner.id, state: 'rejected' })
    expect(await slackJobs()).toEqual([])
  })
})
