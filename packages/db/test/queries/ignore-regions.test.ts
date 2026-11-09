import { createTestDb, seedBuild, seedScreenshot, seedTeam } from '@circi/db/testing'
import { fakeSha } from '@circi/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { listIgnoreRegionSnapshots } from '#src/queries/index.ts'
import { addIgnoreRegion } from '#src/repositories/index.ts'

let t: createTestDb.Result
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(async () => {
  await t.close()
})

describe('listIgnoreRegionSnapshots', () => {
  it('lists names with their region counts and the latest default-branch screenshot', async () => {
    const { team } = await seedTeam(t.db)
    const region = { x: 0, y: 0, width: 5, height: 5 }
    await addIgnoreRegion(t.db, team.id, { name: 'home', ...region })
    await addIgnoreRegion(t.db, team.id, { name: 'home', ...region })
    await addIgnoreRegion(t.db, team.id, { name: 'gone', ...region })

    const old = await seedBuild(t.db, team.id, { branch: 'main', status: 'complete' })
    const latest = await seedBuild(t.db, team.id, { branch: 'main', status: 'complete' })
    const feature = await seedBuild(t.db, team.id, { branch: 'feature', status: 'complete' })
    await seedScreenshot(t.db, { buildId: old.id, name: 'home', fileSha256: fakeSha('1') })
    await seedScreenshot(t.db, {
      buildId: latest.id,
      name: 'home',
      fileSha256: fakeSha('2'),
      width: 800,
      height: 600,
    })
    await seedScreenshot(t.db, { buildId: feature.id, name: 'home', fileSha256: fakeSha('3') })

    expect(await listIgnoreRegionSnapshots(t.db, team.id)).toEqual([
      { name: 'gone', regions: 1, latest: null },
      {
        name: 'home',
        regions: 2,
        latest: { buildNumber: latest.number, sha256: fakeSha('2'), width: 800, height: 600 },
      },
    ])
  })
})
