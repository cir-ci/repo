import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { getBuild } from '@circi/db/queries'
import { enqueueJob } from '@circi/db/queue'
import * as schema from '@circi/db/schema'
import { createTestDb, seedBuild, seedProject } from '@circi/db/testing'
import { FsStorage } from '@circi/storage'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { giveUpExpiredJobs, runJob } from '#src/run-job.ts'
import type { startWorker } from '#src/runner.ts'

let t: createTestDb.Result
let dir: string
let deps: startWorker.Deps
const logged: { level: string; message: string }[] = []
const log = (level: string) => (_fields: unknown, message?: string) =>
  void logged.push({ level, message: message ?? '' })

beforeAll(async () => {
  t = await createTestDb()
  dir = await mkdtemp(join(tmpdir(), 'circi-runjob-'))
  deps = {
    db: t.db,
    storage: new FsStorage({ path: dir }),
    logger: { info: log('info'), warn: log('warn'), error: log('error') },
  }
})
afterAll(async () => {
  await t.close()
  await rm(dir, { recursive: true, force: true })
})

const rowOf = async (id: number) =>
  (await t.db.select().from(schema.jobs).where(eq(schema.jobs.id, id)))[0]

describe('a job whose queue has no handler', () => {
  it('is failed with a clear error instead of running as a build or staying running', async () => {
    const [job] = await t.db
      .insert(schema.jobs)
      .values({
        queue: 'from-the-future',
        payload: {},
        status: 'running',
        attempts: 1,
        maxAttempts: 1,
      })
      .returning()
    if (!job) throw new Error('no job')
    await runJob(deps, job)
    expect(await rowOf(job.id)).toMatchObject({
      status: 'failed',
      lastError: 'no handler for queue "from-the-future"',
    })
    expect(logged.some((l) => l.level === 'error' && l.message.includes('no handler'))).toBe(true)
  })
})

describe('giveUpExpiredJobs', () => {
  it('fails a build job whose worker keeps dying, and fails the build as its give-up', async () => {
    const { project } = await seedProject(t.db)
    const build = await seedBuild(t.db, project.id, { status: 'processing' })
    await enqueueJob(t.db, {
      queue: 'process-build',
      payload: { buildId: build.id },
      maxAttempts: 1,
    })
    const [job] = await t.db
      .update(schema.jobs)
      .set({ status: 'running', attempts: 1, lockedUntil: new Date(0) })
      .where(eq(schema.jobs.queue, 'process-build'))
      .returning()
    if (!job) throw new Error('no job')
    expect(await giveUpExpiredJobs(deps)).toBe(1)
    expect(await rowOf(job.id)).toMatchObject({
      status: 'failed',
      lastError: 'lease expired too many times',
    })
    expect(await getBuild(t.db, build.id)).toMatchObject({
      status: 'error',
      errorMessage: 'lease expired too many times',
    })
    expect(await giveUpExpiredJobs(deps)).toBe(0)
  })
})
