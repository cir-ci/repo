import { createTestDb, type TestDb } from '@circi/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  deleteSetting,
  dismissPublicUrlChange,
  getPublicUrlChange,
  getSetting,
  publicUrlChecklist,
  recordPublicUrl,
  setSetting,
} from '../../src/index.ts'

let t: TestDb
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(async () => {
  await t.close()
})

describe('instance settings', () => {
  it('stores, overwrites and deletes values', async () => {
    expect(await getSetting(t.db, 'k')).toBeUndefined()
    await setSetting(t.db, 'k', 'one')
    await setSetting(t.db, 'k', 'two')
    expect(await getSetting(t.db, 'k')).toBe('two')
    await deleteSetting(t.db, 'k')
    expect(await getSetting(t.db, 'k')).toBeUndefined()
  })
})

describe('dashboard address', () => {
  it('stores the first address quietly, and notices a move until dismissed', async () => {
    expect(await recordPublicUrl(t.db, 'https://ci.old.io')).toBeUndefined()
    expect(await recordPublicUrl(t.db, 'https://ci.old.io')).toBeUndefined()
    expect(await getPublicUrlChange(t.db)).toBeUndefined()

    const moved = await recordPublicUrl(t.db, 'https://ci.new.io')
    expect(moved).toMatchObject({ from: 'https://ci.old.io', to: 'https://ci.new.io' })
    expect(await getPublicUrlChange(t.db)).toMatchObject({ to: 'https://ci.new.io' })
    // A restart with the same address doesn't raise it again, and doesn't clear it either.
    expect(await recordPublicUrl(t.db, 'https://ci.new.io')).toBeUndefined()
    expect(await getPublicUrlChange(t.db)).toBeDefined()

    await dismissPublicUrlChange(t.db)
    expect(await getPublicUrlChange(t.db)).toBeUndefined()
    expect(publicUrlChecklist({ from: 'https://a', to: 'https://b' }).join('\n')).toContain(
      'https://b',
    )
  })
})
