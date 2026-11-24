import { createTestDb } from '@circi/db/testing'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import {
  claimJob,
  completeJob,
  deleteFinishedJobs,
  enqueueJob,
  extendLease,
  failExpiredJobs,
  failJob,
  msUntilNextJob,
} from '#src/queue/index.ts'
import * as schema from '#src/schema/index.ts'

let t: createTestDb.Result

beforeAll(async () => {
  t = await createTestDb()
})
afterAll(async () => {
  await t.close()
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
    await completeJob(t.db, a)
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
    expect(await failJob(t.db, first, 'boom')).toBe('retried')
    // Not due yet because of the backoff.
    expect(await claimJob(t.db, 'q3', 60)).toBeUndefined()
    await t.db
      .update(schema.jobs)
      .set({ runAt: new Date(0) })
      .where(eq(schema.jobs.id, first.id))
    const second = await claimJob(t.db, 'q3', 60)
    if (!second) throw new Error('no retry')
    expect(second.attempts).toBe(2)
    expect(await failJob(t.db, second, 'boom again')).toBe('failed')
    const [row] = await t.db.select().from(schema.jobs).where(eq(schema.jobs.id, first.id))
    expect(row).toMatchObject({ status: 'failed', lastError: 'boom again' })
  })

  it('waits the configured backoff before a retry (the default is 2 s for the first)', async () => {
    const dueIn = async (id: number) => {
      const [row] = await t.db.select().from(schema.jobs).where(eq(schema.jobs.id, id))
      return (row?.runAt.getTime() ?? 0) - Date.now()
    }
    await enqueueJob(t.db, { queue: 'qb1', payload: {} })
    const slow = await claimJob(t.db, 'qb1', 60)
    if (!slow) throw new Error('no job')
    await failJob(t.db, slow, 'x')
    expect(await dueIn(slow.id)).toBeGreaterThan(1_000)
    await enqueueJob(t.db, { queue: 'qb2', payload: {} })
    const fast = await claimJob(t.db, 'qb2', 60)
    if (!fast) throw new Error('no job')
    await failJob(t.db, fast, 'x', { baseMs: 100, maxMs: 1_000 })
    expect(await dueIn(fast.id)).toBeLessThan(500)
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

const expire = (id: number) =>
  t.db
    .update(schema.jobs)
    .set({ lockedUntil: new Date(0) })
    .where(eq(schema.jobs.id, id))
const rowOf = async (id: number) =>
  (await t.db.select().from(schema.jobs).where(eq(schema.jobs.id, id)))[0]

describe('a job whose worker keeps dying', () => {
  it('is not claimed again once its attempts are used; failExpiredJobs fails it', async () => {
    await enqueueJob(t.db, { queue: 'qdie', payload: {}, maxAttempts: 2 })
    const first = await claimJob(t.db, 'qdie', 60)
    if (!first) throw new Error('no job')
    await expire(first.id)
    const second = await claimJob(t.db, 'qdie', 60)
    expect(second?.attempts).toBe(2)
    // A live lease is left alone, even with every attempt used.
    expect(await failExpiredJobs(t.db, ['qdie'])).toEqual([])
    await expire(first.id)
    expect(await claimJob(t.db, 'qdie', 60)).toBeUndefined()
    expect(await rowOf(first.id)).toMatchObject({ status: 'running', attempts: 2 })

    const failed = await failExpiredJobs(t.db, ['qdie'])
    expect(failed.map((j) => j.id)).toEqual([first.id])
    expect(await rowOf(first.id)).toMatchObject({
      status: 'failed',
      lockedUntil: null,
      lastError: 'lease expired too many times',
    })
    expect(await failExpiredJobs(t.db, ['qdie'])).toEqual([])
  })

  it('leaves other queues alone', async () => {
    await enqueueJob(t.db, { queue: 'qdie2', payload: {}, maxAttempts: 1 })
    const job = await claimJob(t.db, 'qdie2', 60)
    if (!job) throw new Error('no job')
    await expire(job.id)
    expect(await failExpiredJobs(t.db, ['qother'])).toEqual([])
    expect(await failExpiredJobs(t.db)).toHaveLength(1)
  })
})

describe('job leases', () => {
  it('ignores the complete and the fail of a claim whose lease expired and was taken again', async () => {
    await enqueueJob(t.db, { queue: 'ql1', payload: {} })
    const first = await claimJob(t.db, 'ql1', 60)
    if (!first) throw new Error('no job')
    await expire(first.id)
    const second = await claimJob(t.db, 'ql1', 60)
    expect(second?.attempts).toBe(first.attempts + 1)
    expect(await completeJob(t.db, first)).toBe(false)
    expect(await failJob(t.db, first, 'late')).toBe('lost')
    expect(await rowOf(first.id)).toMatchObject({ status: 'running', lastError: null })
    if (!second) throw new Error('no second claim')
    expect(await completeJob(t.db, second)).toBe(true)
    expect((await rowOf(first.id))?.status).toBe('done')
  })

  it('a heartbeat keeps a long job leased; a lost claim cannot extend', async () => {
    await enqueueJob(t.db, { queue: 'ql2', payload: {} })
    const job = await claimJob(t.db, 'ql2', 60)
    if (!job) throw new Error('no job')
    // Nearly expired, then extended: nobody else can claim it.
    await t.db
      .update(schema.jobs)
      .set({ lockedUntil: new Date(Date.now() + 100) })
      .where(eq(schema.jobs.id, job.id))
    expect(await extendLease(t.db, job, 60)).toBe(true)
    expect(((await rowOf(job.id))?.lockedUntil?.getTime() ?? 0) - Date.now()).toBeGreaterThan(
      30_000,
    )
    expect(await claimJob(t.db, 'ql2', 60)).toBeUndefined()
    // Once it lapsed and was claimed again, the old claim's heartbeat says so.
    await expire(job.id)
    await claimJob(t.db, 'ql2', 60)
    expect(await extendLease(t.db, job, 60)).toBe(false)
  })
})

describe('claiming across queues', () => {
  it('takes queues in the given priority order, in one statement (no transaction)', async () => {
    await enqueueJob(t.db, { queue: 'qc-b', payload: { n: 'b' } })
    await enqueueJob(t.db, { queue: 'qc-a', payload: { n: 'a' } })
    const spy = vi.spyOn(t.db, 'transaction')
    try {
      const first = await claimJob(t.db, ['qc-a', 'qc-b'], 60)
      const second = await claimJob(t.db, ['qc-a', 'qc-b'], 60)
      expect([first?.payload, second?.payload]).toEqual([{ n: 'a' }, { n: 'b' }])
      expect(spy).not.toHaveBeenCalled()
    } finally {
      spy.mockRestore()
    }
    expect(await claimJob(t.db, ['qc-a', 'qc-b'], 60)).toBeUndefined()
  })

  it('a queue left out of the list is never claimed', async () => {
    await enqueueJob(t.db, { queue: 'qc-heavy', payload: {} })
    expect(await claimJob(t.db, ['qc-light'], 60)).toBeUndefined()
  })
})

const row = (status: 'done' | 'failed' | 'pending' | 'running', finishedAt: Date | null) => ({
  queue: 'qd',
  payload: {},
  status,
  finishedAt,
})

describe('deleteFinishedJobs', () => {
  it('deletes done and failed jobs older than the cutoff, in batches, and nothing else', async () => {
    const old = new Date(Date.now() - 30 * 86_400_000)
    await t.db
      .insert(schema.jobs)
      .values([
        row('done', old),
        row('done', old),
        row('failed', old),
        row('done', new Date()),
        row('pending', null),
        row('running', null),
      ])
    const before = new Date(Date.now() - 14 * 86_400_000)
    expect(await deleteFinishedJobs(t.db, before, 2)).toBe(2)
    expect(await deleteFinishedJobs(t.db, before, 2)).toBe(1)
    expect(await deleteFinishedJobs(t.db, before, 2)).toBe(0)
    const left = await t.db.select().from(schema.jobs).where(eq(schema.jobs.queue, 'qd'))
    expect(left.map((r) => r.status).toSorted()).toEqual(['done', 'pending', 'running'])
  })
})

describe('job notifications', () => {
  it('notifies the jobs channel with the queue name once the job is committed', async () => {
    const received: string[] = []
    const unsub = await t.listen('circi_jobs', (p) => received.push(p))
    try {
      await enqueueJob(t.db, { queue: 'qn1', payload: {} })
      await expect.poll(() => received).toEqual(['qn1'])
    } finally {
      await unsub()
    }
  })

  it('notifies for a job that is not due yet too, so idle workers can sleep until it is', async () => {
    const received: string[] = []
    const unsub = await t.listen('circi_jobs', (p) => received.push(p))
    try {
      await enqueueJob(t.db, { queue: 'qn2', payload: {}, runAt: new Date(Date.now() + 60_000) })
      await enqueueJob(t.db, { queue: 'qn3', payload: {} })
      await expect.poll(() => received).toEqual(['qn2', 'qn3'])
    } finally {
      await unsub()
    }
  })

  it('notifies when a failed job is set to retry, and not when it fails for good', async () => {
    const received: string[] = []
    const unsub = await t.listen('circi_jobs', (p) => received.push(p))
    try {
      await enqueueJob(t.db, { queue: 'qn4', payload: {}, maxAttempts: 2 })
      const first = await claimJob(t.db, 'qn4', 60)
      await failJob(t.db, first!, 'boom', { baseMs: 60_000, maxMs: 60_000 })
      await expect.poll(() => received).toEqual(['qn4', 'qn4'])
      await t.db.update(schema.jobs).set({ runAt: new Date() }).where(eq(schema.jobs.queue, 'qn4'))
      const second = await claimJob(t.db, 'qn4', 60)
      expect(await failJob(t.db, second!, 'boom again')).toBe('failed')
      await enqueueJob(t.db, { queue: 'qn5', payload: {} })
      await expect.poll(() => received).toEqual(['qn4', 'qn4', 'qn5'])
    } finally {
      await unsub()
    }
  })
})

describe('msUntilNextJob', () => {
  it('is undefined with nothing pending, 0 for a due job, and the wait for a later one', async () => {
    expect(await msUntilNextJob(t.db, 'qm')).toBeUndefined()
    await enqueueJob(t.db, { queue: 'qm', payload: {}, runAt: new Date(Date.now() + 30_000) })
    const ms = await msUntilNextJob(t.db, 'qm')
    expect(ms).toBeGreaterThan(25_000)
    expect(ms).toBeLessThanOrEqual(30_000)
    await enqueueJob(t.db, { queue: 'qm', payload: {}, runAt: new Date(Date.now() - 1000) })
    expect(await msUntilNextJob(t.db, ['qm'])).toBe(0)
    // Only the listed queues, and only pending jobs.
    expect(await msUntilNextJob(t.db, 'other-queue')).toBeUndefined()
    expect(await msUntilNextJob(t.db, [])).toBeUndefined()
    await claimJob(t.db, 'qm', 60)
    expect(await msUntilNextJob(t.db, 'qm')).toBeGreaterThan(25_000)
  })
})
