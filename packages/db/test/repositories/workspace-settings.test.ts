import { createTestDb, seedWorkspace } from '@circi/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { getWorkspaceSettings, setWorkspaceSettings } from '#src/index.ts'

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
    expect(await getWorkspaceSettings(t.db, workspace.id)).toEqual({ flakyBlocksMerge: true })
  })

  it('saves what was given, and keeps it across saves', async () => {
    const { workspace } = await seedWorkspace(t.db)
    expect(await setWorkspaceSettings(t.db, workspace.id, { flakyBlocksMerge: false })).toEqual({
      flakyBlocksMerge: false,
    })
    expect(await getWorkspaceSettings(t.db, workspace.id)).toEqual({ flakyBlocksMerge: false })
    // An empty patch changes nothing; switching back works.
    expect(await setWorkspaceSettings(t.db, workspace.id, {})).toEqual({ flakyBlocksMerge: false })
    await setWorkspaceSettings(t.db, workspace.id, { flakyBlocksMerge: true })
    expect(await getWorkspaceSettings(t.db, workspace.id)).toEqual({ flakyBlocksMerge: true })
  })

  it('belongs to one workspace', async () => {
    const a = await seedWorkspace(t.db)
    const b = await seedWorkspace(t.db)
    await setWorkspaceSettings(t.db, a.workspace.id, { flakyBlocksMerge: false })
    expect(await getWorkspaceSettings(t.db, b.workspace.id)).toEqual({ flakyBlocksMerge: true })
  })
})
