import { createTestDb, seedSsoProvider, seedProject, seedUser } from '@circi/db/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { findSsoProviderWorkspaceId, listWorkspaceSsoProviders } from '#src/index.ts'

let t: createTestDb.Result
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(async () => {
  await t.close()
})

describe('workspace SSO lookups', () => {
  it("lists only the workspace's own providers and finds a provider's workspace", async () => {
    const a = await seedProject(t.db)
    const b = await seedProject(t.db)
    const user = await seedUser(t.db)
    const mine = await seedSsoProvider(t.db, {
      workspaceId: a.workspace.id,
      userId: user.id,
      issuer: 'https://idp.a.example',
    })
    await seedSsoProvider(t.db, {
      workspaceId: b.workspace.id,
      userId: user.id,
      issuer: 'https://idp.b.example',
    })
    expect(await listWorkspaceSsoProviders(t.db, a.workspace.id)).toEqual([
      { providerId: mine.providerId, issuer: 'https://idp.a.example' },
    ])
    expect(await findSsoProviderWorkspaceId(t.db, mine.providerId)).toBe(a.workspace.id)
    expect(await findSsoProviderWorkspaceId(t.db, 'nope')).toBeUndefined()
  })
})
