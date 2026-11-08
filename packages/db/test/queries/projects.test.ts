import { addTestMember, createTestDb, seedProject, seedUser, type TestDb } from '@circi/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { listProjectsOverview } from '../../src/index.ts'

let t: TestDb

beforeAll(async () => {
  t = await createTestDb()
})
afterAll(async () => {
  await t.close()
})

describe('listProjectsOverview', () => {
  it('lists only projects in organizations the user belongs to', async () => {
    const mine = await seedProject(t.db)
    const theirs = await seedProject(t.db)
    const shared = await seedProject(t.db)
    await addTestMember(t.db, { orgId: shared.org.id, userId: mine.owner.id })

    const slugs = (await listProjectsOverview(t.db, mine.owner.id)).map((p) => p.org.slug)
    expect(slugs.toSorted()).toEqual([mine.org.slug, shared.org.slug].toSorted())
    expect(slugs).not.toContain(theirs.org.slug)
  })

  it('is empty for a user without organizations', async () => {
    expect(await listProjectsOverview(t.db, (await seedUser(t.db)).id)).toEqual([])
  })
})
