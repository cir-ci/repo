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

import {
  notifyOverdueReviews,
  queueIntegrationEvent,
  requestReview,
  reviewBuild,
} from '#src/index.ts'

let t: createTestDb.Result
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(async () => {
  await t.close()
})

const eventJobs = () =>
  t.db
    .select()
    .from(schema.jobs)
    .where(eq(schema.jobs.queue, QUEUES.integrationEvent))
    .then((rows) => rows.map((r) => r.payload))

const typeOf = (event: unknown) =>
  typeof event === 'object' && event !== null && 'type' in event ? event.type : undefined

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

describe('integration events (outbox)', () => {
  it('queues one job per channel when a rejection commits, with the reason', async () => {
    const { owner, build, integration } = await setup()
    await reviewBuild(t.db, {
      buildId: build.id,
      userId: owner.id,
      state: 'rejected',
      reason: 'bad',
    })
    expect(await eventJobs()).toEqual([
      expect.objectContaining({
        integrationId: integration.id,
        event: expect.objectContaining({
          type: 'build.rejected',
          buildId: build.id,
          reviewerId: owner.id,
          reason: 'bad',
        }),
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
          await tx.select().from(schema.jobs).where(eq(schema.jobs.queue, QUEUES.integrationEvent)),
        ).toHaveLength(2)
        throw new Error('roll back')
      }),
    ).rejects.toThrow('roll back')
    expect(await eventJobs()).toEqual([])
  })

  it('queues nothing when the decision changed nothing, or the event is not listed', async () => {
    const { owner, reviewer, build } = await setup({ events: ['review.overdue'] })
    await reviewBuild(t.db, { buildId: build.id, userId: owner.id, state: 'rejected' })
    await requestReview(t.db, {
      buildId: build.id,
      reviewerId: reviewer.id,
      requestedById: owner.id,
    })
    expect(await eventJobs()).toEqual([])
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
    expect((await eventJobs()).map((j) => typeOf(j.event))).toEqual(['review.requested'])
    await t.db
      .update(schema.reviewRequests)
      .set({ dueAt })
      .where(eq(schema.reviewRequests.id, first.request.id))
    await notifyOverdueReviews(t.db, { now: new Date(dueAt.getTime() + 60_000) })
    await notifyOverdueReviews(t.db, { now: new Date(dueAt.getTime() + 120_000) })
    expect((await eventJobs()).map((j) => typeOf(j.event))).toEqual([
      'review.requested',
      'review.overdue',
    ])
  })

  it('skips an integration that needs attention', async () => {
    const { owner, build, integration } = await setup()
    await setIntegrationAttention(t.db, integration.id, 'token_revoked')
    await reviewBuild(t.db, { buildId: build.id, userId: owner.id, state: 'rejected' })
    expect(await eventJobs()).toEqual([])
  })

  it('queues nothing for an event no definition handles, or for a kind the registry does not know', async () => {
    const { owner, build, project, integration } = await setup()
    // Slack does not handle build.completed.
    expect(await queueIntegrationEvent(t.db, { type: 'build.completed', buildId: build.id })).toBe(
      0,
    )
    await t.db
      .update(schema.integrations)
      .set({ kind: 'not-registered' })
      .where(eq(schema.integrations.id, integration.id))
    await reviewBuild(t.db, { buildId: build.id, userId: owner.id, state: 'rejected' })
    expect(await eventJobs()).toEqual([])
    expect(project.id).toBeTruthy()
  })

  it('queues one job per integration, and the same event for the same build only once', async () => {
    const { owner, build, project, integration } = await setup()
    const org = await t.db
      .select({ orgId: schema.integrations.orgId })
      .from(schema.integrations)
      .where(eq(schema.integrations.id, integration.id))
    const second = await createIntegration(t.db, {
      orgId: org[0]?.orgId ?? '',
      kind: 'slack',
      displayName: 'Second',
      externalId: `T${Math.random().toString(36).slice(2, 8)}`,
    })
    await setIntegrationProject(t.db, {
      integrationId: second.id,
      projectId: project.id,
      externalRef: 'C2',
      extra: {},
    })
    const event = { type: 'build.rejected', buildId: build.id, reviewerId: owner.id } as const
    expect(await queueIntegrationEvent(t.db, event)).toBe(2)
    expect(await queueIntegrationEvent(t.db, event)).toBe(2)
    expect(await eventJobs()).toHaveLength(2)
  })
})
