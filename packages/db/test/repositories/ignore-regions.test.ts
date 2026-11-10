import { createTestDb, seedTeam, seedUser } from '@circi/db/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { NotFoundError } from '#src/index.ts'
import { listIgnoreRegions } from '#src/queries/index.ts'
import {
  addIgnoreRegion,
  changeIgnoreRegion,
  ignoreRegionsByName,
  removeIgnoreRegion,
} from '#src/repositories/index.ts'

let t: createTestDb.Result
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(async () => {
  await t.close()
})

describe('ignore regions', () => {
  it('adds, lists and groups regions by screenshot name, per team', async () => {
    const { team } = await seedTeam(t.db)
    const other = await seedTeam(t.db)
    await addIgnoreRegion(t.db, team.id, { name: 'home', x: 0, y: 0, width: 10, height: 10 })
    await addIgnoreRegion(t.db, team.id, { name: 'home', x: 20, y: 20, width: 5, height: 5 })
    await addIgnoreRegion(t.db, team.id, { name: 'login', x: 1, y: 2, width: 3, height: 4 })
    await addIgnoreRegion(t.db, other.team.id, { name: 'home', x: 9, y: 9, width: 9, height: 9 })
    expect(await listIgnoreRegions(t.db, team.id)).toHaveLength(3)
    const byName = await ignoreRegionsByName(t.db, team.id)
    expect(byName.get('home')).toEqual([
      { x: 0, y: 0, width: 10, height: 10 },
      { x: 20, y: 20, width: 5, height: 5 },
    ])
    expect(byName.get('login')).toHaveLength(1)
    expect(byName.has('missing')).toBe(false)
  })

  it('refuses regions that make no sense', async () => {
    const { team } = await seedTeam(t.db)
    const bad = [
      { name: '', x: 0, y: 0, width: 1, height: 1 },
      { name: 'a', x: -1, y: 0, width: 1, height: 1 },
      { name: 'a', x: 0, y: 0, width: 0, height: 1 },
      { name: 'a', x: 0.5, y: 0, width: 1, height: 1 },
      { name: 'a', x: 0, y: 0, width: 99_999, height: 1 },
    ]
    const outcomes = await Promise.all(
      bad.map((r) =>
        addIgnoreRegion(t.db, team.id, r).then(
          () => 'added',
          () => 'refused',
        ),
      ),
    )
    expect(outcomes).toEqual(Array(5).fill('refused'))
  })

  it("removes only the team's own region", async () => {
    const { team } = await seedTeam(t.db)
    const other = await seedTeam(t.db)
    const mine = await addIgnoreRegion(t.db, team.id, {
      name: 'a',
      x: 0,
      y: 0,
      width: 1,
      height: 1,
    })
    await expect(removeIgnoreRegion(t.db, other.team.id, mine.id)).rejects.toThrow(NotFoundError)
    await removeIgnoreRegion(t.db, team.id, mine.id)
    expect(await listIgnoreRegions(t.db, team.id)).toEqual([])
  })

  it('records who added a region, and moves or renames one', async () => {
    const { team } = await seedTeam(t.db)
    const person = await seedUser(t.db)
    const added = await addIgnoreRegion(t.db, team.id, {
      name: 'home',
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      createdBy: person.id,
    })
    expect(added.createdBy).toEqual({ id: person.id, name: person.name })
    const cli = await addIgnoreRegion(t.db, team.id, {
      name: 'home',
      x: 5,
      y: 5,
      width: 1,
      height: 1,
    })
    expect(cli.createdBy).toBeNull()

    const moved = await changeIgnoreRegion(t.db, team.id, added.id, { x: 4, width: 20 })
    expect(moved).toMatchObject({ x: 4, y: 0, width: 20, height: 10, name: 'home' })
    expect(moved.createdBy).toEqual({ id: person.id, name: person.name })
    expect((await changeIgnoreRegion(t.db, team.id, added.id, { name: ' login ' })).name).toBe(
      'login',
    )
    await expect(changeIgnoreRegion(t.db, team.id, added.id, { width: 0 })).rejects.toThrow(
      /at least 1/,
    )
    await expect(changeIgnoreRegion(t.db, team.id, added.id, { name: ' ' })).rejects.toThrow(
      /name is required/,
    )
    // Another team's region is not found.
    const other = await seedTeam(t.db)
    await expect(changeIgnoreRegion(t.db, other.team.id, added.id, { x: 1 })).rejects.toThrow(
      NotFoundError,
    )
  })
})
