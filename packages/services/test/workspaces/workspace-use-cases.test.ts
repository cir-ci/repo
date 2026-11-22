import { createTestDb } from '@circi/db/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { dismissPublicUrlNotice } from '#src/index.ts'

let t: createTestDb.Result
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(async () => {
  await t.close()
})

describe('instance notices', () => {
  it('dismisses the public address notice (also when there is none)', async () => {
    await expect(dismissPublicUrlNotice(t.db)).resolves.toBeUndefined()
  })
})
