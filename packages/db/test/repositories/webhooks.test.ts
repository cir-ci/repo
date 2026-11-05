import { createTestDb, seedProject, type TestDb } from '@circi/testing'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  completeBuild,
  createBuild,
  createWebhook,
  deleteWebhook,
  listWebhooks,
  NotFoundError,
  QUEUES,
  reviewBuild,
  schema,
} from '../../src/index.ts'

let t: TestDb

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
  const { project, owner } = await seedProject(t.db)
  const build = await createBuild(t.db, {
    projectId: project.id,
    commitSha: 'abc1234',
    branch: 'feature',
  })
  await t.db
    .update(schema.builds)
    .set({ status: 'processing' })
    .where(eq(schema.builds.id, build.id))
  const processing = { ...build, status: 'processing' as const }
  return { project, owner, build: processing }
}

describe('webhooks', () => {
  it('creates a webhook with a secret and all events by default', async () => {
    const { project } = await setup()
    const hook = await createWebhook(t.db, {
      projectId: project.id,
      url: 'https://hooks.acme.io/x',
    })
    expect(hook.secret).toMatch(/^whsec_/)
    expect(hook.events).toEqual(['build.completed', 'build.reviewed'])
    expect(await listWebhooks(t.db, project.id)).toHaveLength(1)
  })

  it('queues build.completed with the build and project details', async () => {
    const { project, build } = await setup()
    const hook = await createWebhook(t.db, {
      projectId: project.id,
      url: 'https://hooks.acme.io/x',
    })
    await completeBuild(t.db, build, { conclusion: 'changes_detected', approval: 'none' })
    const [job, ...rest] = await queued()
    expect(rest).toHaveLength(0)
    expect(job).toMatchObject({
      webhookId: hook.id,
      event: 'build.completed',
      data: {
        project: { slug: project.slug },
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
    const { project, owner, build } = await setup()
    await createWebhook(t.db, {
      projectId: project.id,
      url: 'https://hooks.acme.io/x',
      events: ['build.reviewed'],
    })
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

  it('skips disabled webhooks and other projects', async () => {
    const { project, build } = await setup()
    const other = await seedProject(t.db)
    const hook = await createWebhook(t.db, {
      projectId: project.id,
      url: 'https://hooks.acme.io/x',
    })
    await createWebhook(t.db, { projectId: other.project.id, url: 'https://hooks.other.io/x' })
    await t.db
      .update(schema.webhooks)
      .set({ enabled: false })
      .where(eq(schema.webhooks.id, hook.id))
    await completeBuild(t.db, build, { conclusion: 'no_changes', approval: 'none' })
    expect(await queued()).toHaveLength(0)
  })

  it("deletes only the project's own webhook", async () => {
    const { project } = await setup()
    const other = await seedProject(t.db)
    const hook = await createWebhook(t.db, {
      projectId: project.id,
      url: 'https://hooks.acme.io/x',
    })
    await expect(deleteWebhook(t.db, other.project.id, hook.id)).rejects.toThrow(NotFoundError)
    await deleteWebhook(t.db, project.id, hook.id)
    expect(await listWebhooks(t.db, project.id)).toHaveLength(0)
  })
})
