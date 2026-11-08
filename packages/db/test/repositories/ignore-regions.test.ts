import { createTestDb, seedProject, type TestDb } from '@circi/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  addIgnoreRegion,
  ignoreRegionsByName,
  listIgnoreRegions,
  NotFoundError,
  removeIgnoreRegion,
} from '#src/index.ts'

let t: TestDb
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(async () => {
  await t.close()
})

describe('ignore regions', () => {
  it('adds, lists and groups regions by screenshot name, per project', async () => {
    const { project } = await seedProject(t.db)
    const other = await seedProject(t.db)
    await addIgnoreRegion(t.db, project.id, { name: 'home', x: 0, y: 0, width: 10, height: 10 })
    await addIgnoreRegion(t.db, project.id, { name: 'home', x: 20, y: 20, width: 5, height: 5 })
    await addIgnoreRegion(t.db, project.id, { name: 'login', x: 1, y: 2, width: 3, height: 4 })
    await addIgnoreRegion(t.db, other.project.id, { name: 'home', x: 9, y: 9, width: 9, height: 9 })
    expect(await listIgnoreRegions(t.db, project.id)).toHaveLength(3)
    const byName = await ignoreRegionsByName(t.db, project.id)
    expect(byName.get('home')).toEqual([
      { x: 0, y: 0, width: 10, height: 10 },
      { x: 20, y: 20, width: 5, height: 5 },
    ])
    expect(byName.get('login')).toHaveLength(1)
    expect(byName.has('missing')).toBe(false)
  })

  it('refuses regions that make no sense', async () => {
    const { project } = await seedProject(t.db)
    const bad = [
      { name: '', x: 0, y: 0, width: 1, height: 1 },
      { name: 'a', x: -1, y: 0, width: 1, height: 1 },
      { name: 'a', x: 0, y: 0, width: 0, height: 1 },
      { name: 'a', x: 0.5, y: 0, width: 1, height: 1 },
      { name: 'a', x: 0, y: 0, width: 99_999, height: 1 },
    ]
    const outcomes = await Promise.all(
      bad.map((r) =>
        addIgnoreRegion(t.db, project.id, r).then(
          () => 'added',
          () => 'refused',
        ),
      ),
    )
    expect(outcomes).toEqual(Array(5).fill('refused'))
  })

  it('removes only the project’s own region', async () => {
    const { project } = await seedProject(t.db)
    const other = await seedProject(t.db)
    const mine = await addIgnoreRegion(t.db, project.id, {
      name: 'a',
      x: 0,
      y: 0,
      width: 1,
      height: 1,
    })
    await expect(removeIgnoreRegion(t.db, other.project.id, mine.id)).rejects.toThrow(NotFoundError)
    await removeIgnoreRegion(t.db, project.id, mine.id)
    expect(await listIgnoreRegions(t.db, project.id)).toEqual([])
  })
})
