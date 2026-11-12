import { createTestDb } from '@circi/db/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { exclusiveSweep } from '#src/sweeps.ts'

let t: createTestDb.Result
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(async () => {
  await t.close()
})

describe('exclusiveSweep', () => {
  it('runs one pass when two start at once, and the next one after it finished', async () => {
    let runs = 0
    const { promise: gate, resolve: release } = Promise.withResolvers<void>()
    const sweep = exclusiveSweep(t.db, 'overlap', async () => {
      runs++
      await gate
    })
    const first = sweep()
    const second = sweep()
    expect(await second).toBe(false)
    release()
    expect(await first).toBe(true)
    expect(runs).toBe(1)
    expect(await sweep()).toBe(true)
    expect(runs).toBe(2)
  })

  it('a failing pass releases the guard for the next one', async () => {
    let calls = 0
    const sweep = exclusiveSweep(t.db, 'fails', async () => {
      calls++
      if (calls === 1) throw new Error('boom')
    })
    await expect(sweep()).rejects.toThrow('boom')
    expect(await sweep()).toBe(true)
  })
})
