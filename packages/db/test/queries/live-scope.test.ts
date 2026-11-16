import { addTestMember, createTestDb, seedProject, seedUser } from '@circi/db/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { getLiveScope } from '#queries/index.ts'

let t: createTestDb.Result
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(async () => {
  await t.close()
})

describe('getLiveScope', () => {
  it("gives a member their workspace with their role and the workspace's projects with whether they belong", async () => {
    const { workspace, project, owner } = await seedProject(t.db)
    const ann = await seedUser(t.db)
    await addTestMember(t.db, { workspaceId: workspace.id, userId: ann.id, projects: [] })
    const mine = await getLiveScope(t.db, { userId: ann.id })
    expect(mine.workspaces).toEqual([{ id: workspace.id, slug: workspace.slug, role: 'member' }])
    expect(mine.projects).toEqual([
      { id: project.id, slug: project.slug, workspaceId: workspace.id, isMember: false },
    ])
    const owners = await getLiveScope(t.db, { userId: owner.id })
    expect(owners.workspaces[0]?.role).toBe('owner')
    expect(owners.projects[0]?.isMember).toBe(true)
  })

  it('is empty for someone in no workspace, and holds nothing of other workspaces', async () => {
    await seedProject(t.db)
    const outsider = await seedUser(t.db)
    expect(await getLiveScope(t.db, { userId: outsider.id })).toEqual({
      workspaces: [],
      projects: [],
    })
  })
})
