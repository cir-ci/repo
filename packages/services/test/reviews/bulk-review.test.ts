import { createWebhook, GIT_NOTIFY_QUEUE, QUEUES } from '@circi/db/queue'
import * as schema from '@circi/db/schema'
import { createTestDb, seedBuild, seedGitLink, seedTeam } from '@circi/testing'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { MAX_BULK_REVIEW, reviewBuilds } from '#src/index.ts'

let t: createTestDb.Result
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(async () => {
  await t.close()
})
beforeEach(async () => {
  await t.db.delete(schema.jobs)
})

const jobsIn = async (queue: string) =>
  t.db.select().from(schema.jobs).where(eq(schema.jobs.queue, queue))

const done = {
  status: 'complete',
  conclusion: 'changes_detected',
  changedSnapshots: ['home'],
} as const

async function setup(count = 3) {
  const { team, owner } = await seedTeam(t.db)
  await seedGitLink(t.db, team.id, { externalId: '1', repoRef: 'acme/web' })
  await createWebhook(t.db, {
    teamId: team.id,
    url: 'https://hooks.acme.io/x',
    events: ['build.reviewed'],
  })
  const list = []
  for (let i = 0; i < count; i += 1) {
    // eslint-disable-next-line no-await-in-loop -- sequential numbering
    list.push(await seedBuild(t.db, team.id, done))
  }
  await t.db.delete(schema.jobs)
  return { team, owner, list }
}

const reviewStatuses = async (ids: string[]) =>
  (
    await Promise.all(
      ids.map((id) => t.db.select().from(schema.builds).where(eq(schema.builds.id, id))),
    )
  )
    .flat()
    .map((b) => b.reviewStatus)

describe('reviewBuilds', () => {
  it('approves three builds and queues one set of notices per build', async () => {
    const { team, owner, list } = await setup()
    const result = await reviewBuilds(t.db, {
      teamId: team.id,
      buildIds: list.map((b) => b.id),
      userId: owner.id,
      state: 'approved',
    })
    expect(result.builds.map((b) => b.reviewStatus)).toEqual(['approved', 'approved', 'approved'])
    expect(await jobsIn(QUEUES.webhook)).toHaveLength(3)
    expect(await jobsIn(GIT_NOTIFY_QUEUE)).toHaveLength(3)
    expect(
      await t.db
        .select()
        .from(schema.reviews)
        .where(
          inArray(
            schema.reviews.buildId,
            list.map((b) => b.id),
          ),
        ),
    ).toHaveLength(3)
  })

  it('queues nothing for a build that already had the decision', async () => {
    const { team, owner, list } = await setup(2)
    await t.db
      .update(schema.builds)
      .set({ reviewStatus: 'rejected' })
      .where(eq(schema.builds.id, list[0]!.id))
    await reviewBuilds(t.db, {
      teamId: team.id,
      buildIds: list.map((b) => b.id),
      userId: owner.id,
      state: 'rejected',
      reason: 'wrong colours',
    })
    expect(await jobsIn(QUEUES.webhook)).toHaveLength(1)
    expect(await jobsIn(GIT_NOTIFY_QUEUE)).toHaveLength(1)
  })

  it('changes nothing when one id belongs to another team', async () => {
    const { team, owner, list } = await setup()
    const other = await seedTeam(t.db)
    const foreign = await seedBuild(t.db, other.team.id, done)
    await t.db.delete(schema.jobs)
    await expect(
      reviewBuilds(t.db, {
        teamId: team.id,
        buildIds: [...list.map((b) => b.id), foreign.id],
        userId: owner.id,
        state: 'approved',
      }),
    ).rejects.toThrow('Build not found')
    expect(await reviewStatuses([...list, foreign].map((b) => b.id))).toEqual([
      'pending',
      'pending',
      'pending',
      'pending',
    ])
    expect(await t.db.select().from(schema.jobs)).toHaveLength(0)
  })

  it('rolls back the earlier builds when a later one cannot be reviewed', async () => {
    const { team, owner, list } = await setup(2)
    const unfinished = await seedBuild(t.db, team.id)
    await t.db.delete(schema.jobs)
    await expect(
      reviewBuilds(t.db, {
        teamId: team.id,
        buildIds: [...list.map((b) => b.id), unfinished.id],
        userId: owner.id,
        state: 'approved',
      }),
    ).rejects.toThrow(/can be reviewed once it's complete/)
    expect(await reviewStatuses(list.map((b) => b.id))).toEqual(['pending', 'pending'])
    expect(await t.db.select().from(schema.jobs)).toHaveLength(0)
    expect(
      await t.db.select().from(schema.reviews).where(eq(schema.reviews.buildId, list[0]!.id)),
    ).toHaveLength(0)
  })

  it('refuses an empty list and more than the maximum', async () => {
    const { team, owner } = await setup(1)
    const base = { teamId: team.id, userId: owner.id, state: 'approved' as const }
    await expect(reviewBuilds(t.db, { ...base, buildIds: [] })).rejects.toThrow('at least one')
    const many = Array.from({ length: MAX_BULK_REVIEW + 1 }, (_, i) => String(i))
    await expect(reviewBuilds(t.db, { ...base, buildIds: many })).rejects.toThrow('at most')
  })
})
