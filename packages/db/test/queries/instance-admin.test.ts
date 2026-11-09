import { createTestDb } from '@circi/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { enqueueJob, getQueueDepth, QUEUES } from '#src/index.ts'

let t: createTestDb.Result
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(async () => {
  await t.close()
})

describe('getQueueDepth', () => {
  it('lists every known queue by default, even when empty', async () => {
    const depth = await getQueueDepth(t.db)
    expect(depth.map((q) => q.queue).toSorted()).toEqual(Object.values(QUEUES).toSorted())
    expect(depth.every((q) => q.pending === 0)).toBe(true)
  })

  it('counts pending jobs, and lists only the queues asked for when given', async () => {
    await enqueueJob(t.db, { queue: QUEUES.webhook, payload: { n: 1 } })
    const all = await getQueueDepth(t.db)
    expect(all.find((q) => q.queue === QUEUES.webhook)?.pending).toBe(1)
    expect(
      (await getQueueDepth(t.db, [QUEUES.processBuild])).map((q) => q.queue).toSorted(),
    ).toEqual([QUEUES.processBuild, QUEUES.webhook].toSorted())
  })
})
