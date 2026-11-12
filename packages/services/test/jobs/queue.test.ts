import type { Database } from '@circi/db'
import { enqueueJob, GIT_NOTIFY_QUEUE, QUEUES } from '@circi/db/queue'
import * as schema from '@circi/db/schema'
import { createTestDb } from '@circi/db/testing'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { claimNextJob, pruneFinishedJobs, runExclusive } from '#src/index.ts'

let t: createTestDb.Result
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(async () => {
  await t.close()
})

describe('claimNextJob', () => {
  it('serves light jobs on a light lane while builds are backed up, one query per claim', async () => {
    await t.reset()
    await enqueueJob(t.db, { queue: QUEUES.processBuild, payload: {} })
    await enqueueJob(t.db, { queue: QUEUES.processBuild, payload: {} })
    await enqueueJob(t.db, { queue: QUEUES.processBuild, payload: {} })
    await enqueueJob(t.db, { queue: QUEUES.webhook, payload: { n: 'hook' } })
    await enqueueJob(t.db, { queue: GIT_NOTIFY_QUEUE, payload: { n: 'git' } })
    const spy = vi.spyOn(t.db, 'transaction')
    try {
      const a = await claimNextJob(t.db, 60, { light: true })
      const b = await claimNextJob(t.db, 60, { light: true })
      expect([a?.queue, b?.queue]).toEqual([GIT_NOTIFY_QUEUE, QUEUES.webhook])
      expect(await claimNextJob(t.db, 60, { light: true })).toBeUndefined()
      expect(spy).not.toHaveBeenCalled()
    } finally {
      spy.mockRestore()
    }
  })

  it('a build lane takes builds before light jobs', async () => {
    await t.reset()
    await enqueueJob(t.db, { queue: QUEUES.webhook, payload: {} })
    await enqueueJob(t.db, { queue: QUEUES.processBuild, payload: {} })
    expect((await claimNextJob(t.db, 60))?.queue).toBe(QUEUES.processBuild)
    expect((await claimNextJob(t.db, 60))?.queue).toBe(QUEUES.webhook)
  })
})

describe('runExclusive', () => {
  it('skips the pass when another process holds the lock', async () => {
    const fn = vi.fn<() => Promise<number>>(async () => 1)
    // PGlite has one connection, so another process holding the lock is faked at the transaction.
    const tx = { execute: async () => ({ rows: [{ locked: false }] }) }
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a stub of the transaction
    const held = { transaction: (run: (tx: unknown) => unknown) => run(tx) } as unknown as Database
    expect(await runExclusive(held, 'x', fn)).toEqual({ ran: false })
    expect(fn).not.toHaveBeenCalled()
  })

  it('runs the pass when the lock is free', async () => {
    const result = await runExclusive(t.db, 'free', async () => 'done')
    expect(result).toEqual({ ran: true, value: 'done' })
  })
})

describe('pruneFinishedJobs', () => {
  it('deletes finished jobs older than the retention only, across batches', async () => {
    await t.reset()
    const day = 86_400_000
    const row = (status: 'done' | 'failed' | 'pending', ageDays: number | null) => ({
      queue: 'qp',
      payload: {},
      status,
      finishedAt: ageDays === null ? null : new Date(Date.now() - ageDays * day),
    })
    await t.db
      .insert(schema.jobs)
      .values([
        row('done', 20),
        row('done', 20),
        row('failed', 15),
        row('done', 1),
        row('failed', 2),
        row('pending', null),
      ])
    expect(await pruneFinishedJobs(t.db, { olderThanDays: 14, batchSize: 2 })).toBe(3)
    const left = await t.db.select().from(schema.jobs)
    expect(left).toHaveLength(3)
    expect(left.map((r) => r.status).toSorted()).toEqual(['done', 'failed', 'pending'])
  })
})
