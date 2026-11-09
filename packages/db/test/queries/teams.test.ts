import { addTestMember, createTestDb, seedTeam, seedUser } from '@circi/db/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { listTeamsOverview } from '#src/queries/index.ts'

let t: createTestDb.Result

beforeAll(async () => {
  t = await createTestDb()
})
afterAll(async () => {
  await t.close()
})

describe('listTeamsOverview', () => {
  it('lists only teams in workspaces the user belongs to', async () => {
    const mine = await seedTeam(t.db)
    const theirs = await seedTeam(t.db)
    const shared = await seedTeam(t.db)
    await addTestMember(t.db, { workspaceId: shared.workspace.id, userId: mine.owner.id })

    const slugs = (await listTeamsOverview(t.db, mine.owner.id)).map((p) => p.workspace.slug)
    expect(slugs.toSorted()).toEqual([mine.workspace.slug, shared.workspace.slug].toSorted())
    expect(slugs).not.toContain(theirs.workspace.slug)
  })

  it('is empty for a user without workspaces', async () => {
    expect(await listTeamsOverview(t.db, (await seedUser(t.db)).id)).toEqual([])
  })
})
