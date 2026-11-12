import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { type ListenFn } from '@circi/db'
import { enqueueJob, JOBS_CHANNEL } from '@circi/db/queue'
import * as schema from '@circi/db/schema'
import { createTestDb } from '@circi/db/testing'
import { FsStorage } from '@circi/storage'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { startWorker } from '#src/index.ts'

let t: createTestDb.Result
let dir: string
let storage: FsStorage
const silentListen: ListenFn = async () => async () => {}
const broken: ListenFn = async () => {
  throw new Error('no listen')
}
const silent = { info() {}, warn() {}, error() {} }

beforeAll(async () => {
  t = await createTestDb()
  dir = await mkdtemp(join(tmpdir(), 'circi-runner-'))
  storage = new FsStorage({ path: dir })
})
afterAll(async () => {
  await t.close()
  await rm(dir, { recursive: true, force: true })
})

/** A job the worker claims and fails for good at once (no buildId): `attempts` > 0 once claimed. */
async function enqueueProbe(queue = 'process-build', runAt?: Date) {
  await enqueueJob(t.db, {
    queue,
    payload: {},
    maxAttempts: 1,
    ...(runAt ? { runAt } : {}),
  })
  const rows = await t.db.select().from(schema.jobs).where(eq(schema.jobs.queue, queue))
  return rows.at(-1)!.id
}

const attemptsOf = async (id: number) =>
  (await t.db.select().from(schema.jobs).where(eq(schema.jobs.id, id)))[0]?.attempts

/** Waits until the worker has claimed the job; resolves with how long that took, fails on timeout. */
async function untilClaimed(id: number, timeout: number): Promise<number> {
  const start = Date.now()
  await expect.poll(() => attemptsOf(id), { timeout, interval: 5 }).toBeGreaterThan(0)
  return Date.now() - start
}

describe('worker wake-up by NOTIFY', () => {
  it('claims a job enqueued while idle well under the poll interval (PGlite LISTEN)', async () => {
    const worker = await startWorker({
      db: t.db,
      storage,
      logger: silent,
      pollIntervalMs: 10_000,
      listen: t.listen,
    })
    try {
      const id = await enqueueProbe()
      const ms = await untilClaimed(id, 2_000)
      console.log(`notify pickup latency: ${ms} ms`)
      expect(ms).toBeGreaterThanOrEqual(0)
      expect(ms).toBeLessThan(500)
    } finally {
      await worker.stop()
    }
  })

  it('does not notify, and enqueues nothing, when the transaction rolls back', async () => {
    const received: string[] = []
    const unsub = await t.listen(JOBS_CHANNEL, (p) => received.push(p))
    try {
      await expect(
        t.db.transaction(async (tx) => {
          await enqueueJob(tx, { queue: 'rolled-back', payload: {} })
          throw new Error('rollback')
        }),
      ).rejects.toThrow('rollback')
      expect(
        await t.db.select().from(schema.jobs).where(eq(schema.jobs.queue, 'rolled-back')),
      ).toEqual([])
      await enqueueJob(t.db, { queue: 'committed', payload: {} })
      // Notifications arrive in order: a notice from the rolled-back transaction would come first.
      await expect.poll(() => received).toEqual(['committed'])
    } finally {
      await unsub()
    }
  })

  it('still runs jobs by polling when the listener never notifies', async () => {
    const worker = await startWorker({
      db: t.db,
      storage,
      logger: silent,
      pollIntervalMs: 30,
      listen: silentListen,
    })
    try {
      const id = await enqueueProbe()
      expect(await untilClaimed(id, 3_000)).toBeGreaterThanOrEqual(0)
    } finally {
      await worker.stop()
    }
  })

  it('still runs jobs by polling when the listener cannot connect, and logs once', async () => {
    const warnings: unknown[] = []
    const worker = await startWorker({
      db: t.db,
      storage,
      logger: { ...silent, warn: (o) => warnings.push(o) },
      pollIntervalMs: 30,
      listen: broken,
    })
    try {
      const id = await enqueueProbe()
      expect(await untilClaimed(id, 3_000)).toBeGreaterThanOrEqual(0)
      expect(warnings).toHaveLength(1)
    } finally {
      await worker.stop()
    }
  })

  it('does not run a job scheduled for later when notified', async () => {
    const worker = await startWorker({
      db: t.db,
      storage,
      logger: silent,
      pollIntervalMs: 10_000,
      listen: t.listen,
    })
    try {
      const later = await enqueueProbe('process-build', new Date(Date.now() + 60_000))
      const now = await enqueueProbe() // notifies; the worker wakes, claims this one only
      expect(await untilClaimed(now, 2_000)).toBeGreaterThanOrEqual(0)
      expect(await attemptsOf(later)).toBe(0)
    } finally {
      await worker.stop()
    }
  })

  it('runs a job enqueued with a future run time at that time, not at the next poll', async () => {
    const worker = await startWorker({
      db: t.db,
      storage,
      logger: silent,
      pollIntervalMs: 10_000,
      listen: t.listen,
    })
    try {
      // The notification the enqueue sends wakes the idle lanes; they find nothing due, ask when
      // the earliest job is, and sleep until then.
      // Timed from before the enqueue: on a busy machine the enqueue alone can take a good part of
      // the 400 ms, and the job is still due at its run time, not 400 ms after the enqueue returns.
      const start = Date.now()
      const id = await enqueueProbe('process-build', new Date(start + 400))
      await untilClaimed(id, 3_000)
      const ms = Date.now() - start
      expect(ms).toBeGreaterThanOrEqual(390)
      expect(ms).toBeLessThan(2_500)
    } finally {
      await worker.stop()
    }
  })

  it('wakes for a retry when its backoff is over, not at the next poll', async () => {
    const worker = await startWorker({
      db: t.db,
      storage,
      logger: silent,
      pollIntervalMs: 10_000,
      listen: t.listen,
      retryBackoff: { baseMs: 150, maxMs: 150 },
    })
    try {
      // No buildId, so every attempt fails; the first leaves the job pending 150 ms ahead.
      await enqueueJob(t.db, { queue: 'process-build', payload: {}, maxAttempts: 2 })
      const id = (
        await t.db.select().from(schema.jobs).where(eq(schema.jobs.queue, 'process-build'))
      ).at(-1)!.id
      await expect.poll(() => attemptsOf(id), { timeout: 3_000, interval: 5 }).toBe(2)
    } finally {
      await worker.stop()
    }
  })

  it('reconnects the listener after it is lost, then wakes on the next notification', async () => {
    let lose: ((err: Error) => void) | undefined
    let notify: ((p: string) => void) | undefined
    let connects = 0
    const flaky: ListenFn = async (_channel, onNotify, onLost) => {
      connects += 1
      lose = onLost
      notify = onNotify
      return async () => {}
    }
    const worker = await startWorker({
      db: t.db,
      storage,
      logger: silent,
      pollIntervalMs: 10_000,
      listen: flaky,
    })
    try {
      expect(connects).toBe(1)
      lose?.(new Error('dropped'))
      await expect.poll(() => connects, { timeout: 3_000 }).toBe(2)
      const id = await enqueueProbe() // committed without a real notification reaching us
      notify?.('process-build')
      expect(await untilClaimed(id, 1_000)).toBeGreaterThanOrEqual(0)
    } finally {
      await worker.stop()
    }
  })

  it('stop() closes the listener', async () => {
    let open = 0
    const counted: ListenFn = async () => {
      open += 1
      return async () => {
        open -= 1
      }
    }
    const worker = await startWorker({
      db: t.db,
      storage,
      logger: silent,
      pollIntervalMs: 10_000,
      listen: counted,
    })
    expect(open).toBe(1)
    await worker.stop()
    expect(open).toBe(0)
  })
})
