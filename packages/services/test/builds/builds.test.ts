import { GIT_NOTIFY_QUEUE, QUEUES } from '@circi/db/queue'
import { createBuild, markFileVerified, planUploads } from '@circi/db/repositories'
import * as schema from '@circi/db/schema'
import { createTestDb, seedGitLink, seedProject, seedChangedSnapshots } from '@circi/db/testing'
import { fakeSha } from '@circi/testing'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import {
  completeBuild,
  describeStall,
  expireStalledBuilds,
  failBuild,
  finalizeBuild,
  requeueBuild,
  reviewBuild,
} from '#src/index.ts'

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

async function newBuild(options: { linked?: boolean; parallelTotal?: number } = {}) {
  const { project, owner } = await seedProject(t.db)
  if (options.linked) {
    await seedGitLink(t.db, project.id, { externalId: '1', repoRef: 'acme/web' })
  }
  const build = await createBuild(t.db, {
    projectId: project.id,
    commitSha: 'abc1234',
    ...(options.parallelTotal ? { parallel: { nonce: 'n', total: options.parallelTotal } } : {}),
  })
  return { project, owner, build }
}

async function verified(buildId: string, hash: string) {
  await planUploads(t.db, {
    buildId,
    kind: 'screenshot',
    files: [{ sha256: hash, size: 10, contentType: 'image/png' }],
    storageKeyFor: (s) => `files/${s}`,
  })
  await markFileVerified(t.db, hash, { size: 10 })
}

describe('finalizeBuild', () => {
  it('queues exactly one diff job when the last shard arrives', async () => {
    const { build } = await newBuild()
    await verified(build.id, fakeSha('1'))
    const res = await finalizeBuild(t.db, {
      buildId: build.id,
      screenshots: [{ name: 'home', sha256: fakeSha('1') }],
    })
    expect(res).toMatchObject({ status: 'ok', complete: true })
    const queued = await jobsIn(QUEUES.processBuild)
    expect(queued).toHaveLength(1)
    expect(queued[0]?.payload).toEqual({ buildId: build.id })
  })

  it('queues nothing while shards are missing, or files are not uploaded yet', async () => {
    const { build } = await newBuild({ parallelTotal: 2 })
    await verified(build.id, fakeSha('2'))
    const first = await finalizeBuild(t.db, {
      buildId: build.id,
      shardIndex: '0',
      screenshots: [{ name: 'a', sha256: fakeSha('2') }],
    })
    expect(first).toMatchObject({ complete: false })
    const missing = await finalizeBuild(t.db, {
      buildId: build.id,
      shardIndex: '1',
      screenshots: [{ name: 'b', sha256: fakeSha('3') }],
    })
    expect(missing.status).toBe('missing')
    expect(await jobsIn(QUEUES.processBuild)).toHaveLength(0)
  })

  it('tells the git host the build is processing, when the project is linked', async () => {
    const { build } = await newBuild({ linked: true })
    await verified(build.id, fakeSha('4'))
    await finalizeBuild(t.db, {
      buildId: build.id,
      screenshots: [{ name: 'x', sha256: fakeSha('4') }],
    })
    expect(await jobsIn(GIT_NOTIFY_QUEUE)).toHaveLength(1)
  })

  it('does not queue a second diff job for a build that is already processing', async () => {
    const { build } = await newBuild()
    await verified(build.id, fakeSha('5'))
    await finalizeBuild(t.db, {
      buildId: build.id,
      screenshots: [{ name: 'x', sha256: fakeSha('5') }],
    })
    await expect(finalizeBuild(t.db, { buildId: build.id, screenshots: [] })).rejects.toThrow(
      /already processing/,
    )
    expect(await jobsIn(QUEUES.processBuild)).toHaveLength(1)
  })
})

describe('completeBuild, failBuild and requeueBuild', () => {
  it('announces a completed build to the git host and sets its outcome', async () => {
    const { build } = await newBuild({ linked: true })
    await t.db
      .update(schema.builds)
      .set({ status: 'processing' })
      .where(eq(schema.builds.id, build.id))
    await seedChangedSnapshots(t.db, build.id)
    await completeBuild(
      t.db,
      { ...build, status: 'processing' },
      { conclusion: 'changes_detected', approval: 'none' },
    )
    const [row] = await t.db.select().from(schema.builds).where(eq(schema.builds.id, build.id))
    expect(row).toMatchObject({
      status: 'complete',
      conclusion: 'changes_detected',
      reviewStatus: 'pending',
    })
    expect(await jobsIn(GIT_NOTIFY_QUEUE)).toHaveLength(1)
  })

  it('announces a failure once, and ignores a build that no longer exists', async () => {
    const { build } = await newBuild({ linked: true })
    await failBuild(t.db, build.id, 'bad png')
    expect(await jobsIn(GIT_NOTIFY_QUEUE)).toHaveLength(1)
    await expect(
      failBuild(t.db, '00000000-0000-0000-0000-000000000000', 'x'),
    ).resolves.toBeUndefined()
  })

  it('puts a finished build back in the queue, losing its decision', async () => {
    const { build, owner } = await newBuild()
    await t.db
      .update(schema.builds)
      .set({ status: 'processing' })
      .where(eq(schema.builds.id, build.id))
    await seedChangedSnapshots(t.db, build.id)
    await completeBuild(
      t.db,
      { ...build, status: 'processing' },
      { conclusion: 'changes_detected', approval: 'none' },
    )
    await reviewBuild(t.db, { buildId: build.id, userId: owner.id, state: 'approved' })
    await requeueBuild(t.db, build.id)
    const [row] = await t.db.select().from(schema.builds).where(eq(schema.builds.id, build.id))
    expect(row).toMatchObject({ status: 'processing', conclusion: null, reviewStatus: 'pending' })
    expect((await jobsIn(QUEUES.processBuild)).some((j) => j.payload.buildId === build.id)).toBe(
      true,
    )
    // Still processing now, so it can't be requeued again.
    await expect(requeueBuild(t.db, build.id)).rejects.toThrow(/still processing/)
  })
})

describe('reviewBuild', () => {
  it('notifies once per real change, not for a repeated decision', async () => {
    const { build, owner } = await newBuild({ linked: true })
    await t.db
      .update(schema.builds)
      .set({ status: 'processing' })
      .where(eq(schema.builds.id, build.id))
    await seedChangedSnapshots(t.db, build.id)
    await completeBuild(
      t.db,
      { ...build, status: 'processing' },
      { conclusion: 'changes_detected', approval: 'none' },
    )
    await t.db.delete(schema.jobs)
    await reviewBuild(t.db, { buildId: build.id, userId: owner.id, state: 'approved' })
    await reviewBuild(t.db, { buildId: build.id, userId: owner.id, state: 'approved' })
    expect(await jobsIn(GIT_NOTIFY_QUEUE)).toHaveLength(1)
    await reviewBuild(t.db, { buildId: build.id, userId: owner.id, state: 'rejected' })
    expect((await jobsIn(GIT_NOTIFY_QUEUE)).length).toBe(2)
  })

  it('queues nothing when the review is refused', async () => {
    const { build, owner } = await newBuild({ linked: true })
    await expect(
      reviewBuild(t.db, { buildId: build.id, userId: owner.id, state: 'approved' }),
    ).rejects.toThrow(/can be reviewed once/)
    expect(await jobsIn(GIT_NOTIFY_QUEUE)).toHaveLength(0)
  })
})

const later = () => new Date(Date.now() + 60_000)

describe('expireStalledBuilds', () => {
  it('fails a parallel build naming the shards that never came, and ignores recent ones', async () => {
    const { build } = await newBuild({ parallelTotal: 4 })
    await verified(build.id, fakeSha('7'))
    await finalizeBuild(t.db, {
      buildId: build.id,
      shardIndex: '1',
      screenshots: [{ name: 'a', sha256: fakeSha('7') }],
    })
    // Created just now: not stalled yet.
    expect(await expireStalledBuilds(t.db, new Date(Date.now() - 3_600_000))).toBe(0)
    expect(await expireStalledBuilds(t.db, later())).toBeGreaterThanOrEqual(1)
    const [row] = await t.db.select().from(schema.builds).where(eq(schema.builds.id, build.id))
    expect(row?.status).toBe('error')
    expect(row?.errorMessage).toContain('3 of 4 shard(s): shard 1, 3, 4')
  })

  it('fails a plain upload that never finished, and leaves processing builds alone', async () => {
    const stalled = await newBuild({ linked: true })
    const processing = await newBuild()
    await t.db
      .update(schema.builds)
      .set({ status: 'processing' })
      .where(eq(schema.builds.id, processing.build.id))
    await expireStalledBuilds(t.db, later())
    const rows = await t.db.select().from(schema.builds)
    const byId = new Map(rows.map((r) => [r.id, r]))
    expect(byId.get(stalled.build.id)?.errorMessage).toMatch(/never finished/)
    expect(byId.get(processing.build.id)?.status).toBe('processing')
    expect((await jobsIn(GIT_NOTIFY_QUEUE)).length).toBeGreaterThanOrEqual(1)
  })
})

const stalled = async (total: number) => (await newBuild({ parallelTotal: total })).build

describe('describeStall', () => {
  it('lists missing shards one-based, and gives up listing when there are many', async () => {
    expect(describeStall(await stalled(30), ['0', '1'])).not.toContain(': shard')
    expect(describeStall(await stalled(3), ['1'])).toContain('shard 1, 3')
  })
})
