import { addTestMember, createTestDb, seedProject, seedUser } from '@circi/db/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { listProjectsOverview } from '#src/queries/index.ts'

let t: createTestDb.Result

beforeAll(async () => {
  t = await createTestDb()
})
afterAll(async () => {
  await t.close()
})

describe('listProjectsOverview', () => {
  it('lists only projects in workspaces the user belongs to', async () => {
    const mine = await seedProject(t.db)
    const theirs = await seedProject(t.db)
    const shared = await seedProject(t.db)
    await addTestMember(t.db, { workspaceId: shared.workspace.id, userId: mine.owner.id })

    const slugs = (await listProjectsOverview(t.db, mine.owner.id)).map((p) => p.workspace.slug)
    expect(slugs.toSorted()).toEqual([mine.workspace.slug, shared.workspace.slug].toSorted())
    expect(slugs).not.toContain(theirs.workspace.slug)
  })

  it('is empty for a user without workspaces', async () => {
    expect(await listProjectsOverview(t.db, (await seedUser(t.db)).id)).toEqual([])
  })
})
