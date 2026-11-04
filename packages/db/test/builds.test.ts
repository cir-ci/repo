import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  claimJob,
  completeJob,
  createBuild,
  enqueueJob,
  failJob,
  finalizeBuild,
  markFileVerified,
  planUploads,
  schema,
} from '../src/index.ts'
import { createTestDb, seedProject, sha, type TestDb } from './helpers.ts'

let t: TestDb

beforeAll(async () => {
  t = await createTestDb()
})
afterAll(async () => {
  await t.close()
})

const keyFor = (s: string) => `${s.slice(0, 2)}/${s}/gen`
const png = (s: string) => ({ sha256: s, size: 10, contentType: 'image/png' })

async function newBuild(overrides: Partial<Parameters<typeof createBuild>[1]> = {}) {
  const { project } = await seedProject(t.db)
  const build = await createBuild(t.db, {
    projectId: project.id,
    commitSha: 'abc1234',
    ...overrides,
  })
  return { project, build }
}

describe('createBuild', () => {
  it('numbers builds per project', async () => {
    const { project } = await seedProject(t.db)
    const a = await createBuild(t.db, { projectId: project.id, commitSha: 'aaaaaaa' })
    const b = await createBuild(t.db, { projectId: project.id, commitSha: 'bbbbbbb' })
    expect([a.number, b.number]).toEqual([1, 2])
    expect(a.status).toBe('uploading')
    expect(a.ancestryStatus).toBe('missing')
  })

  it('joins the existing build for another shard of the same parallel run', async () => {
    const { project } = await seedProject(t.db)
    const input = {
      projectId: project.id,
      commitSha: 'ccccccc',
      parallel: { nonce: 'run-7', total: 2 },
    }
    const a = await createBuild(t.db, input)
    const b = await createBuild(t.db, input)
    expect(b.id).toBe(a.id)
  })

  it('rejects invalid input', async () => {
    const { project } = await seedProject(t.db)
    await expect(
      createBuild(t.db, { projectId: project.id, commitSha: 'not-a-sha' }),
    ).rejects.toThrow(/Invalid commit SHA/)
    await expect(
      createBuild(t.db, { projectId: project.id, commitSha: 'abc1234', name: 'has space' }),
    ).rejects.toThrow(/Invalid build name/)
  })
})

describe('planUploads (verify before dedup)', () => {
  it('asks for every unknown file and creates pending rows', async () => {
    const { build } = await newBuild()
    const planned = await planUploads(t.db, {
      buildId: build.id,
      kind: 'screenshot',
      files: [png(sha('1')), png(sha('2')), png(sha('1'))],
      storageKeyFor: keyFor,
    })
    expect(planned.map((p) => p.sha256).toSorted()).toEqual([sha('1'), sha('2')])
    const [row] = await t.db
      .select()
      .from(schema.files)
      .where(eq(schema.files.sha256, sha('1')))
    expect(row).toMatchObject({ status: 'pending', storageKey: keyFor(sha('1')) })
  })

  it('never deduplicates against a pending file', async () => {
    const first = await newBuild()
    await planUploads(t.db, {
      buildId: first.build.id,
      kind: 'screenshot',
      files: [png(sha('3'))],
      storageKeyFor: keyFor,
    })
    const second = await newBuild()
    const planned = await planUploads(t.db, {
      buildId: second.build.id,
      kind: 'screenshot',
      files: [png(sha('3'))],
      storageKeyFor: keyFor,
    })
    expect(planned.map((p) => p.sha256)).toEqual([sha('3')])
  })

  it('deduplicates verified files and records an upload claim for them', async () => {
    const first = await newBuild()
    await planUploads(t.db, {
      buildId: first.build.id,
      kind: 'screenshot',
      files: [png(sha('4'))],
      storageKeyFor: keyFor,
    })
    await markFileVerified(t.db, sha('4'), { size: 10 })

    const second = await newBuild()
    const planned = await planUploads(t.db, {
      buildId: second.build.id,
      kind: 'screenshot',
      files: [png(sha('4'))],
      storageKeyFor: keyFor,
    })
    expect(planned).toEqual([])
    const claims = await t.db
      .select()
      .from(schema.uploadClaims)
      .where(eq(schema.uploadClaims.buildId, second.build.id))
    expect(claims.map((c) => c.fileSha256)).toEqual([sha('4')])
  })

  it('rejects malformed hashes', async () => {
    const { build } = await newBuild()
    await expect(
      planUploads(t.db, {
        buildId: build.id,
        kind: 'screenshot',
        files: [png('nope')],
        storageKeyFor: keyFor,
      }),
    ).rejects.toThrow(/Invalid sha256/)
  })
})

async function uploaded(buildId: string, shas: string[]) {
  await planUploads(t.db, {
    buildId,
    kind: 'screenshot',
    files: shas.map(png),
    storageKeyFor: keyFor,
  })
  await Promise.all(shas.map((s) => markFileVerified(t.db, s, { size: 10 })))
}

describe('finalizeBuild', () => {
  it('refuses screenshots whose files are not verified, listing them', async () => {
    const { build } = await newBuild()
    await planUploads(t.db, {
      buildId: build.id,
      kind: 'screenshot',
      files: [png(sha('5'))],
      storageKeyFor: keyFor,
    })
    const res = await finalizeBuild(t.db, {
      buildId: build.id,
      screenshots: [{ name: 'home', sha256: sha('5') }],
    })
    expect(res).toEqual({ status: 'missing', missing: [sha('5')] })
  })

  it('moves a single-shard build to processing and enqueues exactly one job', async () => {
    const { build } = await newBuild()
    await uploaded(build.id, [sha('6'), sha('7')])
    const res = await finalizeBuild(t.db, {
      buildId: build.id,
      screenshots: [
        { name: 'home', sha256: sha('6') },
        { name: 'login', sha256: sha('7'), metadata: { browser: 'chromium' } },
      ],
    })
    expect(res).toEqual({ status: 'ok', complete: true, shardsReceived: 1, shardsTotal: 1 })
    const [row] = await t.db.select().from(schema.builds).where(eq(schema.builds.id, build.id))
    expect(row?.status).toBe('processing')
    const jobs = await t.db.select().from(schema.jobs).where(eq(schema.jobs.dedupeKey, build.id))
    expect(jobs).toHaveLength(1)
    const claims = await t.db
      .select()
      .from(schema.uploadClaims)
      .where(eq(schema.uploadClaims.buildId, build.id))
    expect(claims).toEqual([])

    await expect(finalizeBuild(t.db, { buildId: build.id, screenshots: [] })).rejects.toThrow(
      /already processing/,
    )
  })

  it('waits for every shard, and a retried shard replaces its screenshots', async () => {
    const { build } = await newBuild({ parallel: { nonce: 'n1', total: 2 } })
    await uploaded(build.id, [sha('8'), sha('9'), sha('a')])
    const first = await finalizeBuild(t.db, {
      buildId: build.id,
      shardIndex: '0',
      screenshots: [{ name: 'a', sha256: sha('8') }],
    })
    expect(first).toMatchObject({ complete: false, shardsReceived: 1, shardsTotal: 2 })
    const retry = await finalizeBuild(t.db, {
      buildId: build.id,
      shardIndex: '0',
      screenshots: [{ name: 'a2', sha256: sha('9') }],
    })
    expect(retry).toMatchObject({ complete: false, shardsReceived: 1 })
    const last = await finalizeBuild(t.db, {
      buildId: build.id,
      shardIndex: '1',
      screenshots: [{ name: 'b', sha256: sha('a') }],
    })
    expect(last).toMatchObject({ complete: true, shardsReceived: 2 })
    const shots = await t.db
      .select({ name: schema.screenshots.name })
      .from(schema.screenshots)
      .where(eq(schema.screenshots.buildId, build.id))
    expect(shots.map((s) => s.name).toSorted()).toEqual(['a2', 'b'])
  })

  it('rejects duplicate names within a shard', async () => {
    const { build } = await newBuild()
    await uploaded(build.id, [sha('b')])
    await expect(
      finalizeBuild(t.db, {
        buildId: build.id,
        screenshots: [
          { name: 'x', sha256: sha('b') },
          { name: 'x', sha256: sha('b') },
        ],
      }),
    ).rejects.toThrow(/Duplicate screenshot name/)
  })
})

describe('job queue', () => {
  it('claims due jobs in order, once each', async () => {
    await enqueueJob(t.db, { queue: 'q1', payload: { n: 1 } })
    await enqueueJob(t.db, { queue: 'q1', payload: { n: 2 } })
    const a = await claimJob(t.db, 'q1', 60)
    const b = await claimJob(t.db, 'q1', 60)
    expect([a?.payload, b?.payload]).toEqual([{ n: 1 }, { n: 2 }])
    expect(await claimJob(t.db, 'q1', 60)).toBeUndefined()
    if (!a) throw new Error('no job')
    await completeJob(t.db, a.id)
    const [done] = await t.db.select().from(schema.jobs).where(eq(schema.jobs.id, a.id))
    expect(done?.status).toBe('done')
  })

  it('ignores a duplicate enqueue while a job with the same key is pending', async () => {
    await enqueueJob(t.db, { queue: 'q2', payload: {}, dedupeKey: 'k' })
    await enqueueJob(t.db, { queue: 'q2', payload: {}, dedupeKey: 'k' })
    const rows = await t.db.select().from(schema.jobs).where(eq(schema.jobs.queue, 'q2'))
    expect(rows).toHaveLength(1)
  })

  it('retries with backoff, then fails for good after max attempts', async () => {
    await enqueueJob(t.db, { queue: 'q3', payload: {}, maxAttempts: 2 })
    const first = await claimJob(t.db, 'q3', 60)
    if (!first) throw new Error('no job')
    expect(await failJob(t.db, first, 'boom')).toBe(true)
    // Not due yet because of the backoff.
    expect(await claimJob(t.db, 'q3', 60)).toBeUndefined()
    await t.db
      .update(schema.jobs)
      .set({ runAt: new Date(0) })
      .where(eq(schema.jobs.id, first.id))
    const second = await claimJob(t.db, 'q3', 60)
    if (!second) throw new Error('no retry')
    expect(second.attempts).toBe(2)
    expect(await failJob(t.db, second, 'boom again')).toBe(false)
    const [row] = await t.db.select().from(schema.jobs).where(eq(schema.jobs.id, first.id))
    expect(row).toMatchObject({ status: 'failed', lastError: 'boom again' })
  })

  it('picks up a running job whose lock expired (crashed worker)', async () => {
    await enqueueJob(t.db, { queue: 'q4', payload: {} })
    const job = await claimJob(t.db, 'q4', 60)
    if (!job) throw new Error('no job')
    await t.db
      .update(schema.jobs)
      .set({ lockedUntil: new Date(0) })
      .where(eq(schema.jobs.id, job.id))
    const again = await claimJob(t.db, 'q4', 60)
    expect(again?.id).toBe(job.id)
  })
})
