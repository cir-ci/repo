import { createTestDb, seedBuild, seedDiff, seedTeam } from '@circi/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { getSnapshotHistory } from '#src/queries/index.ts'

let t: createTestDb.Result
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(async () => {
  await t.close()
})

describe('getSnapshotHistory', () => {
  it('lists the newest builds with the snapshot, per branch, newest first', async () => {
    const { team } = await seedTeam(t.db)
    const numbers: Record<string, number[]> = { main: [], feature: [] }
    for (const [branch, name, status] of [
      ['main', 'checkout/home', 'unchanged'],
      ['main', 'other', 'unchanged'],
      ['feature', 'checkout/home', 'changed'],
      ['main', 'checkout/home', 'changed'],
      ['main', 'checkout/home', 'added'],
      ['feature', 'checkout/home', 'unchanged'],
    ] as const) {
      // oxlint-disable-next-line no-await-in-loop -- ordered fixture
      const build = await seedBuild(t.db, team.id, { branch, status: 'complete' })
      // oxlint-disable-next-line no-await-in-loop -- ordered fixture
      await seedDiff(t.db, { buildId: build.id, name, status })
      if (name === 'checkout/home') numbers[branch]?.push(build.number)
    }

    const both = await getSnapshotHistory(t.db, {
      teamId: team.id,
      name: 'checkout/home',
      branch: 'feature',
    })
    expect(both?.defaultBranch).toBe('main')
    expect(both?.default.map((e) => [e.build.number, e.status])).toEqual([
      [numbers.main?.[2], 'added'],
      [numbers.main?.[1], 'changed'],
      [numbers.main?.[0], 'unchanged'],
    ])
    expect(both?.branch?.map((e) => e.build.number)).toEqual((numbers.feature ?? []).toReversed())
    expect(both?.default[0]?.image).toBeNull()
    expect(both?.default[0]?.build).toMatchObject({ branch: 'main', status: 'complete' })

    const anchored = await getSnapshotHistory(t.db, {
      teamId: team.id,
      name: 'checkout/home',
      build: numbers.main?.[1] ?? 0,
    })
    expect(anchored?.default.map((e) => e.build.number)).toEqual([
      numbers.main?.[1],
      numbers.main?.[0],
    ])

    const limited = await getSnapshotHistory(t.db, {
      teamId: team.id,
      name: 'checkout/home',
      limit: 2,
    })
    expect(limited?.default).toHaveLength(2)
    expect(limited?.branch).toBeNull()
    const sameAsDefault = await getSnapshotHistory(t.db, {
      teamId: team.id,
      name: 'checkout/home',
      branch: 'main',
    })
    expect(sameAsDefault?.branch).toBeNull()
    expect((await getSnapshotHistory(t.db, { teamId: team.id, name: 'nope' }))?.default).toEqual([])
    expect(
      await getSnapshotHistory(t.db, { teamId: '00000000-0000-0000-0000-000000000000', name: 'x' }),
    ).toBeUndefined()
  })
})
