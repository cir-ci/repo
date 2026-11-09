import { getMoveChecklistDismissedFor } from '@circi/db/queries'
import { createTestDb } from '@circi/db/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { dismissMoveChecklist, restoreMoveChecklist } from '#src/index.ts'

let t: createTestDb.Result
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(async () => {
  await t.close()
})

describe('the move checklist', () => {
  it('is dismissed for one address and shown again on request', async () => {
    expect(await getMoveChecklistDismissedFor(t.db)).toBeUndefined()
    await dismissMoveChecklist(t.db, 'https://ci.acme.io')
    expect(await getMoveChecklistDismissedFor(t.db)).toBe('https://ci.acme.io')
    await restoreMoveChecklist(t.db)
    expect(await getMoveChecklistDismissedFor(t.db)).toBeUndefined()
  })

  it('remembers the address, so another address is not dismissed', async () => {
    await dismissMoveChecklist(t.db, 'https://old.acme.io')
    expect(await getMoveChecklistDismissedFor(t.db)).not.toBe('https://ci.acme.io')
    await dismissMoveChecklist(t.db, 'https://ci.acme.io')
    expect(await getMoveChecklistDismissedFor(t.db)).toBe('https://ci.acme.io')
  })
})
