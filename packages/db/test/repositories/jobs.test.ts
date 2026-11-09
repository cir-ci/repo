import { createTestDb } from '@circi/testing'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { claimJob, completeJob, enqueueJob, failJob } from '#src/queue/index.ts'
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

describe('job notifications', () => {
  it('notifies the jobs channel with the queue name once the job is committed', async () => {
    const received: string[] = []
    const unsub = await t.client.listen('circi_jobs', (p) => received.push(p))
    try {
      await enqueueJob(t.db, { queue: 'qn1', payload: {} })
      await expect.poll(() => received).toEqual(['qn1'])
    } finally {
      await unsub()
    }
  })

  it('does not notify for a job that is not due yet', async () => {
    const received: string[] = []
    const unsub = await t.client.listen('circi_jobs', (p) => received.push(p))
    try {
      await enqueueJob(t.db, { queue: 'qn2', payload: {}, runAt: new Date(Date.now() + 60_000) })
      await enqueueJob(t.db, { queue: 'qn3', payload: {} })
      await expect.poll(() => received).toEqual(['qn3'])
    } finally {
      await unsub()
    }
  })
})
