import { createTestDb, seedWorkspace } from '@circi/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createTeam, getTeamById, getWorkspaceSettings, setWorkspaceSettings } from '#src/index.ts'

let t: createTestDb.Result
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(async () => {
  await t.close()
})

describe('workspace settings', () => {
  it('defaults to today’s behaviour: flaky screenshots block merges', async () => {
    const { workspace } = await seedWorkspace(t.db)
    expect(await getWorkspaceSettings(t.db, workspace.id)).toEqual({
      flakyBlocksMerge: true,
      retentionDays: 30,
    })
  })

  it('saves what was given, and keeps it across saves', async () => {
    const { workspace } = await seedWorkspace(t.db)
    const off = { flakyBlocksMerge: false, retentionDays: 30 }
    expect(await setWorkspaceSettings(t.db, workspace.id, { flakyBlocksMerge: false })).toEqual(off)
    expect(await getWorkspaceSettings(t.db, workspace.id)).toEqual(off)
    // An empty patch changes nothing; switching back works.
    expect(await setWorkspaceSettings(t.db, workspace.id, {})).toEqual(off)
    await setWorkspaceSettings(t.db, workspace.id, { flakyBlocksMerge: true })
    expect(await getWorkspaceSettings(t.db, workspace.id)).toEqual({
      flakyBlocksMerge: true,
      retentionDays: 30,
    })
  })

  it('saves a default retention, refuses less than a day, and gives it to new teams only', async () => {
    const { workspace } = await seedWorkspace(t.db)
    const before = await createTeam(t.db, { workspaceSlug: workspace.slug, name: 'before' })
    expect(await setWorkspaceSettings(t.db, workspace.id, { retentionDays: 90 })).toEqual({
      flakyBlocksMerge: true,
      retentionDays: 90,
    })
    await expect(setWorkspaceSettings(t.db, workspace.id, { retentionDays: 0 })).rejects.toThrow(
      /at least 1 day/,
    )
    await expect(setWorkspaceSettings(t.db, workspace.id, { retentionDays: 1.5 })).rejects.toThrow(
      /at least 1 day/,
    )
    const after = await createTeam(t.db, { workspaceSlug: workspace.slug, name: 'after' })
    expect(after.retentionDays).toBe(90)
    expect((await getTeamById(t.db, before.id))?.retentionDays).toBe(30)
  })

  it('belongs to one workspace', async () => {
    const a = await seedWorkspace(t.db)
    const b = await seedWorkspace(t.db)
    await setWorkspaceSettings(t.db, a.workspace.id, { flakyBlocksMerge: false })
    expect(await getWorkspaceSettings(t.db, b.workspace.id)).toEqual({
      flakyBlocksMerge: true,
      retentionDays: 30,
    })
  })
})
