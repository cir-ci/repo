import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { Job } from '@circi/db'
import { JOBS_CHANNEL, enqueueJob, QUEUES } from '@circi/db/queue'
import { seedBuild, seedProject } from '@circi/db/testing'
import {
  claimNextJob,
  completeJob,
  extendJobLease,
  failExpiredJobs,
  failJob,
} from '@circi/services'
import { FsStorage } from '@circi/storage'
import { startWorker } from '@circi/worker'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { freshDatabase, type TestDatabase } from '#clients/database.ts'
import { useStack } from '#stack/vitest.ts'

interface JobRow extends Record<string, unknown> {
  id: string
  queue: string
  status: string
  attempts: number
  last_error: string | null
}

const must = <T>(value: T | undefined): T => {
  if (value === undefined) throw new Error('expected a value')
  return value
}

const silent = { info() {}, warn() {}, error() {} }

/**
 * The job queue on real Postgres, from several connection pools at once (a pool is what one
 * worker process has). PGlite has one session, so `FOR UPDATE SKIP LOCKED` never meets a second
 * claimer there.
 */
describe('job queue on real Postgres', () => {
  const ctx = useStack({ profile: 'default' })
  let database: TestDatabase
  let dir: string

  beforeAll(async () => {
    database = await freshDatabase(ctx.stack)
    dir = await mkdtemp(join(tmpdir(), 'circi-e2e-jobs-'))
  })
  afterAll(async () => {
    await database.close()
    await rm(dir, { recursive: true, force: true })
  })
  beforeEach(async () => {
    await database.query('delete from jobs')
  })

  const row = async (id: number | string) =>
    (await database.query<JobRow>('select * from jobs where id = $1', [id]))[0]
  const expireLease = (id: number | string) =>
    database.query(`update jobs set locked_until = now() - interval '1 second' where id = $1`, [id])

  const startIdle = async (name: string, pollIntervalMs: number) => {
    const handle = database.open({ poolMax: 4, applicationName: name })
    const worker = await startWorker({
      db: handle.db,
      storage: new FsStorage({ path: dir }),
      logger: silent,
      listen: handle.listen,
      pollIntervalMs,
      concurrency: 1,
      lightLanes: 0,
      maintenanceIntervalMs: 0,
      retentionIntervalMs: 0,
      reviewSweepIntervalMs: 0,
      triageAssignIntervalMs: 0,
      leaseSweepIntervalMs: 0,
      jobPruneIntervalMs: 0,
      retryBackoff: { baseMs: 400, maxMs: 400 },
    })
    return { handle, worker }
  }

  describe('leases', () => {
    it('a claim whose lease expired is claimed again, and the first holder can no longer complete, fail or extend it', async () => {
      const first = database.open({ poolMax: 2, applicationName: 'worker-a' }).db
      const second = database.open({ poolMax: 2, applicationName: 'worker-b' }).db
      await enqueueJob(first, { queue: QUEUES.webhook, payload: { n: 1 }, maxAttempts: 5 })

      const claimA = must(await claimNextJob(first, 60))
      expect(claimA.attempts).toBe(1)
      // Nobody else can take it while the lease lives.
      expect(await claimNextJob(second, 60)).toBeUndefined()

      // Worker A stalls; its lease runs out and worker B takes the job over.
      await expireLease(claimA.id)
      const claimB = must(await claimNextJob(second, 60))
      expect(claimB.id).toBe(claimA.id)
      expect(claimB.attempts).toBe(2)

      // Everything A still tries is ignored: the fence is the claim number.
      expect(await completeJob(first, claimA)).toBe(false)
      expect(await failJob(first, claimA, 'too late')).toBe('lost')
      expect(await extendJobLease(first, claimA, 60)).toBe(false)
      expect(await row(claimA.id)).toMatchObject({
        status: 'running',
        attempts: 2,
        last_error: null,
      })

      // B's claim is the one that counts.
      expect(await extendJobLease(second, claimB, 60)).toBe(true)
      expect(await completeJob(second, claimB)).toBe(true)
      expect(await row(claimA.id)).toMatchObject({ status: 'done', attempts: 2 })
      // And a finished job stays finished whatever a stale holder does later.
      expect(await failJob(first, claimA, 'much too late')).toBe('lost')
      expect(await row(claimA.id)).toMatchObject({ status: 'done' })
    })

    it('a job whose attempts are used and whose lease expired is not claimed again; the expired-leases sweep fails it and runs its give-up', async () => {
      const a = database.open({ poolMax: 2, applicationName: 'crash-a' })
      const b = database.open({ poolMax: 2, applicationName: 'crash-b' })
      const { project } = await seedProject(a.db)
      const build = await seedBuild(a.db, project.id, { status: 'processing' })
      await enqueueJob(a.db, {
        queue: QUEUES.processBuild,
        payload: { buildId: build.id },
        maxAttempts: 2,
      })

      // The worker claims it and dies, twice: each time the lease runs out and it is due again.
      const first = must(await claimNextJob(a.db, 60))
      await expireLease(first.id)
      const second = must(await claimNextJob(b.db, 60))
      expect(second.attempts).toBe(2)
      await expireLease(second.id)

      // All attempts are used: no worker takes it again, from either pool, on either lane kind.
      expect(await claimNextJob(a.db, 60)).toBeUndefined()
      expect(await claimNextJob(b.db, 60, { light: true })).toBeUndefined()
      expect(await row(first.id)).toMatchObject({ status: 'running', attempts: 2 })

      // The sweep of a worker process fails it and gives up: the build is failed with the reason.
      const storage = new FsStorage({ path: dir })
      const worker = await startWorker({
        db: a.db,
        storage,
        logger: silent,
        listen: a.listen,
        pollIntervalMs: 200,
        leaseSweepIntervalMs: 100,
        maintenanceIntervalMs: 0,
        retentionIntervalMs: 0,
        reviewSweepIntervalMs: 0,
        triageAssignIntervalMs: 0,
        jobPruneIntervalMs: 0,
      })
      try {
        await expect
          .poll(async () => (await row(first.id))?.status, { timeout: 10_000 })
          .toBe('failed')
        expect(await row(first.id)).toMatchObject({
          attempts: 2,
          last_error: 'lease expired too many times',
        })
        await expect
          .poll(
            async () =>
              (
                await database.query('select status, error_message from builds where id = $1', [
                  build.id,
                ])
              )[0],
            { timeout: 10_000 },
          )
          .toEqual({ status: 'error', error_message: 'lease expired too many times' })
      } finally {
        await worker.stop()
      }
      // Nothing left to fail: a second pass does nothing.
      expect(await failExpiredJobs(a.db)).toEqual([])
    })

    it('two processes failing the same expired job: it is failed, and given up, once', async () => {
      const a = database.open({ poolMax: 2, applicationName: 'sweep-a' }).db
      const b = database.open({ poolMax: 2, applicationName: 'sweep-b' }).db
      await enqueueJob(a, { queue: QUEUES.webhook, payload: {}, maxAttempts: 1 })
      const claimed = must(await claimNextJob(a, 60))
      await expireLease(claimed.id)
      const results = await Promise.all([failExpiredJobs(a), failExpiredJobs(b)])
      expect(results.flat().map((j) => j.id)).toEqual([claimed.id])
    })
  })

  describe('lanes', () => {
    it('lanes of several processes never claim the same job, and a light lane never takes a build', async () => {
      const BUILDS = 30
      const HOOKS = 60
      const pools = Array.from(
        { length: 3 },
        (_, i) => database.open({ poolMax: 4, applicationName: `lanes-${i}` }).db,
      )
      await Promise.all([
        ...Array.from({ length: BUILDS }, (_, n) =>
          enqueueJob(pools[0]!, { queue: QUEUES.processBuild, payload: { n } }),
        ),
        ...Array.from({ length: HOOKS }, (_, n) =>
          enqueueJob(pools[1]!, { queue: QUEUES.webhook, payload: { n } }),
        ),
      ])

      // Six lanes, two per pool: one that takes builds first and one that never takes a build.
      const claimed: { lane: string; job: Job }[] = []
      const lane = async (db: (typeof pools)[number], name: string, light: boolean) => {
        for (;;) {
          // oxlint-disable-next-line no-await-in-loop -- a lane claims one job at a time
          const job = await claimNextJob(db, 60, { light })
          if (!job) return
          claimed.push({ lane: name, job })
          // oxlint-disable-next-line no-await-in-loop -- a lane runs one job at a time
          expect(await completeJob(db, job)).toBe(true)
        }
      }
      await Promise.all(
        pools.flatMap((db, i) => [lane(db, `build-${i}`, false), lane(db, `light-${i}`, true)]),
      )

      const ids = claimed.map((c) => c.job.id)
      expect(ids).toHaveLength(BUILDS + HOOKS)
      expect(new Set(ids).size).toBe(ids.length)
      expect(claimed.every((c) => c.job.attempts === 1)).toBe(true)
      expect(
        claimed.filter((c) => c.lane.startsWith('light') && c.job.queue === QUEUES.processBuild),
      ).toEqual([])
      // Every job ran exactly once, and the table agrees.
      const rows = await database.query<{ status: string; n: string }>(
        'select status, count(*) as n from jobs group by status',
      )
      expect(rows).toEqual([{ status: 'done', n: String(BUILDS + HOOKS) }])
    })

    it('a worker with only light lanes leaves a build queued', async () => {
      const handle = database.open({ poolMax: 4, applicationName: 'light-worker' })
      // A build job that would fail at once (no buildId), then a webhook job the worker settles at
      // once: when the webhook is settled, the worker has certainly looked at the queue.
      await enqueueJob(handle.db, { queue: QUEUES.processBuild, payload: {} })
      const worker = await startWorker({
        db: handle.db,
        storage: new FsStorage({ path: dir }),
        logger: silent,
        listen: handle.listen,
        pollIntervalMs: 100,
        concurrency: 0,
        lightLanes: 1,
        maintenanceIntervalMs: 0,
        retentionIntervalMs: 0,
        reviewSweepIntervalMs: 0,
        triageAssignIntervalMs: 0,
        leaseSweepIntervalMs: 0,
        jobPruneIntervalMs: 0,
      })
      try {
        await enqueueJob(handle.db, { queue: QUEUES.webhook, payload: {}, maxAttempts: 1 })
        await expect
          .poll(
            async () =>
              (await database.query<JobRow>(`select * from jobs where queue = 'webhook'`))[0]
                ?.status,
            { timeout: 10_000 },
          )
          .toMatch(/^(done|failed)$/)
        expect(
          (await database.query<JobRow>(`select * from jobs where queue = 'process-build'`))[0],
        ).toMatchObject({ status: 'pending', attempts: 0 })
      } finally {
        await worker.stop()
      }
    })
  })

  describe('wake-up of idle workers', () => {
    const POLL = 10_000

    it('a job its own worker failed is retried at its backoff, not at the next poll', async () => {
      const { handle, worker } = await startIdle('retry-same-process', POLL)
      try {
        // No buildId, so every attempt fails; the first leaves the job pending 400 ms ahead.
        await enqueueJob(handle.db, { queue: QUEUES.processBuild, payload: {}, maxAttempts: 2 })
        await expect
          .poll(async () => (await database.query<JobRow>('select * from jobs'))[0]?.last_error, {
            timeout: 5_000,
            interval: 5,
          })
          .toContain('no buildId')
        const failedAt = Date.now()
        await expect
          .poll(async () => (await database.query<JobRow>('select * from jobs'))[0]?.status, {
            timeout: 5_000,
            interval: 5,
          })
          .toBe('failed')
        const waited = Date.now() - failedAt
        expect(waited).toBeLessThan(3_000)
        expect(waited).toBeLessThan(POLL / 2)
      } finally {
        await worker.stop()
      }
    })

    it('a retry set by another process wakes an idle worker at its backoff, not at its poll', async () => {
      const outsider = database.open({ poolMax: 2, applicationName: 'other-process' }).db
      await enqueueJob(outsider, { queue: QUEUES.processBuild, payload: {}, maxAttempts: 3 })
      // The other process holds the job (claimed, running) while the worker starts and idles.
      const held = must(await claimNextJob(outsider, 60))
      const { worker } = await startIdle('retry-other-process', POLL)
      try {
        const began = Date.now()
        // It fails there; the retry is due in 400 ms and the worker is told by NOTIFY.
        expect(await failJob(outsider, held, 'failed elsewhere', { baseMs: 400, maxMs: 400 })).toBe(
          'retried',
        )
        // The worker claims it at about 400 ms (and, having no buildId to build, fails it again).
        await expect
          .poll(async () => (await row(held.id))?.attempts, { timeout: 5_000, interval: 5 })
          .toBeGreaterThanOrEqual(2)
        const waited = Date.now() - began
        expect(waited).toBeGreaterThanOrEqual(300)
        expect(waited).toBeLessThan(3_000)
      } finally {
        await worker.stop()
      }
    })

    it('a job enqueued with a future run time starts at that time in an idle worker, not at its poll', async () => {
      const outsider = database.open({ poolMax: 2, applicationName: 'enqueuer' }).db
      const { worker } = await startIdle('delayed', POLL)
      try {
        const began = Date.now()
        await enqueueJob(outsider, {
          queue: QUEUES.processBuild,
          payload: {},
          runAt: new Date(began + 500),
          maxAttempts: 1,
        })
        await expect
          .poll(async () => (await database.query<JobRow>('select * from jobs'))[0]?.status, {
            timeout: 5_000,
            interval: 5,
          })
          .toBe('failed')
        const waited = Date.now() - began
        expect(waited).toBeGreaterThanOrEqual(450)
        expect(waited).toBeLessThan(3_000)
      } finally {
        await worker.stop()
      }
    })

    it('a worker whose listener is down still finds a delayed job at its poll (the one limit left)', async () => {
      const handle = database.open({ poolMax: 2, applicationName: 'no-listener' })
      const worker = await startWorker({
        db: handle.db,
        storage: new FsStorage({ path: dir }),
        logger: silent,
        // Never delivers a notification: the poll is all this worker has.
        listen: async () => async () => {},
        pollIntervalMs: 1_000,
        concurrency: 1,
        lightLanes: 0,
        maintenanceIntervalMs: 0,
        retentionIntervalMs: 0,
        reviewSweepIntervalMs: 0,
        triageAssignIntervalMs: 0,
        leaseSweepIntervalMs: 0,
        jobPruneIntervalMs: 0,
      })
      try {
        await enqueueJob(handle.db, {
          queue: QUEUES.processBuild,
          payload: {},
          runAt: new Date(Date.now() + 200),
          maxAttempts: 1,
        })
        await expect
          .poll(async () => (await database.query<JobRow>('select * from jobs'))[0]?.status, {
            timeout: 10_000,
          })
          .toBe('failed')
      } finally {
        await worker.stop()
      }
    })

    it('notifies the jobs channel for a delayed enqueue and for a retry, on real connections', async () => {
      const outsider = database.open({ poolMax: 2, applicationName: 'notifier' })
      const received: string[] = []
      const stop = await outsider.listen(JOBS_CHANNEL, (payload) => received.push(payload))
      try {
        await enqueueJob(outsider.db, {
          queue: QUEUES.webhook,
          payload: {},
          runAt: new Date(Date.now() + 60_000),
          maxAttempts: 2,
        })
        await expect.poll(() => received).toEqual([QUEUES.webhook])
        await database.query(`update jobs set run_at = now()`)
        const job = must(await claimNextJob(outsider.db, 60))
        await failJob(outsider.db, job, 'x', { baseMs: 60_000, maxMs: 60_000 })
        await expect.poll(() => received).toEqual([QUEUES.webhook, QUEUES.webhook])
      } finally {
        await stop()
      }
    })
  })
})
