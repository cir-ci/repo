import { createBuild, createWebhook, QUEUES, schema } from '@circi/db'
import { createTestDb, seedTeam, seedChangedSnapshots } from '@circi/testing'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { completeBuild, reviewBuild } from '#src/index.ts'

let t: createTestDb.Result

beforeAll(async () => {
  t = await createTestDb()
})
afterAll(async () => {
  await t.close()
})

async function queued() {
  const rows = await t.db.select().from(schema.jobs).where(eq(schema.jobs.queue, QUEUES.webhook))
  return rows.map((j) => j.payload)
}

async function setup() {
  await t.db.delete(schema.jobs)
  const { team, owner } = await seedTeam(t.db)
  const build = await createBuild(t.db, {
    teamId: team.id,
    commitSha: 'abc1234',
    branch: 'feature',
  })
  await t.db
    .update(schema.builds)
    .set({ status: 'processing' })
    .where(eq(schema.builds.id, build.id))
  const processing = { ...build, status: 'processing' as const }
  return { team, owner, build: processing }
}

describe('webhook events', () => {
  it('queues build.completed with the build and team details', async () => {
    const { team, build } = await setup()
    const hook = await createWebhook(t.db, {
      teamId: team.id,
      url: 'https://hooks.acme.io/x',
      events: ['build.completed', 'build.reviewed'],
    })
    await seedChangedSnapshots(t.db, build.id)
    await completeBuild(t.db, build, { conclusion: 'changes_detected', approval: 'none' })
    const [job, ...rest] = await queued()
    expect(rest).toHaveLength(0)
    expect(job).toMatchObject({
      webhookId: hook.id,
      event: 'build.completed',
      data: {
        team: { slug: team.slug },
        build: {
          number: 1,
          status: 'complete',
          conclusion: 'changes_detected',
          reviewStatus: 'pending',
        },
      },
    })
  })

  it('queues build.reviewed with the reviewer', async () => {
    const { team, owner, build } = await setup()
    await createWebhook(t.db, {
      teamId: team.id,
      url: 'https://hooks.acme.io/x',
      events: ['build.reviewed'],
    })
    await seedChangedSnapshots(t.db, build.id)
    await completeBuild(t.db, build, { conclusion: 'changes_detected', approval: 'none' })
    expect(await queued()).toHaveLength(0) // not subscribed to build.completed
    await reviewBuild(t.db, { buildId: build.id, userId: owner.id, state: 'approved' })
    const [job] = await queued()
    expect(job).toMatchObject({
      event: 'build.reviewed',
      data: {
        build: { reviewStatus: 'approved' },
        review: { state: 'approved', source: 'ui', reviewer: owner.name },
      },
    })
  })

  it('skips disabled webhooks and other teams', async () => {
    const { team, build } = await setup()
    const other = await seedTeam(t.db)
    const hook = await createWebhook(t.db, {
      teamId: team.id,
      url: 'https://hooks.acme.io/x',
      events: ['build.completed'],
    })
    await createWebhook(t.db, {
      teamId: other.team.id,
      url: 'https://hooks.other.io/x',
      events: ['build.completed'],
    })
    await t.db
      .update(schema.webhooks)
      .set({ enabled: false })
      .where(eq(schema.webhooks.id, hook.id))
    await completeBuild(t.db, build, { conclusion: 'no_changes', approval: 'none' })
    expect(await queued()).toHaveLength(0)
  })
})
