import { createTestDb, seedProject } from '@circi/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { deviceFingerprint, noteDevice, takeEmailCodeSlot } from '#src/index.ts'

let t: createTestDb.Result
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(async () => {
  await t.close()
})

describe('email code limit', () => {
  it('lets an address ask a few times, then refuses, whatever the case or spacing', async () => {
    const results: boolean[] = []
    for (const email of ['A@x.test', ' a@x.test', 'a@X.test', 'a@x.test', 'a@x.test', 'a@x.test']) {
      // eslint-disable-next-line no-await-in-loop -- order matters
      results.push(await takeEmailCodeSlot(t.db, email))
    }
    expect(results).toEqual([true, true, true, true, true, false])
  })

  it('counts addresses separately, and forgets old requests', async () => {
    expect(await takeEmailCodeSlot(t.db, 'b@x.test', { limit: 1 })).toBe(true)
    expect(await takeEmailCodeSlot(t.db, 'b@x.test', { limit: 1 })).toBe(false)
    expect(await takeEmailCodeSlot(t.db, 'c@x.test', { limit: 1 })).toBe(true)
    // A window of zero means everything is already old.
    expect(await takeEmailCodeSlot(t.db, 'b@x.test', { limit: 1, windowMs: 0 })).toBe(true)
  })
})

describe('known devices', () => {
  it('tells the first sign-in from a new device from a known one', async () => {
    const { owner } = await seedProject(t.db)
    const laptop = deviceFingerprint('Firefox on macOS')
    const phone = deviceFingerprint('Safari on iOS')
    expect(await noteDevice(t.db, owner.id, laptop)).toBe('first')
    expect(await noteDevice(t.db, owner.id, laptop)).toBe('known')
    expect(await noteDevice(t.db, owner.id, phone)).toBe('new')
    expect(await noteDevice(t.db, owner.id, phone)).toBe('known')
    expect(deviceFingerprint(null)).toBe(deviceFingerprint(''))
  })
})
