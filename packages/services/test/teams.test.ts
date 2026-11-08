import { createTestDb, seedTeam } from '@circi/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { updateTeamAppearance } from '#src/index.ts'

let t: createTestDb.Result
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(async () => {
  await t.close()
})

describe('updateTeamAppearance', () => {
  it('saves colour and icon, and a bad value changes neither', async () => {
    const { team } = await seedTeam(t.db)
    expect(await updateTeamAppearance(t.db, team.id, { color: 'plum', icon: 'zap' })).toEqual({
      color: 'plum',
      icon: 'zap',
    })
    await expect(
      updateTeamAppearance(t.db, team.id, { color: 'olive', icon: 'bogus' }),
    ).rejects.toThrow(/icon/)
    expect(await updateTeamAppearance(t.db, team.id, {})).toEqual({ color: 'plum', icon: 'zap' })
  })
})
