import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { getMigrationStatus, listMemberSignIn, pingDatabase } from '#queries/index.ts'
import * as schema from '#schema/index.ts'
import { addTestMember, createTestDb, seedUser, seedWorkspace } from '#src/testing/index.ts'

let t: createTestDb.Result
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(async () => {
  await t.close()
})

let n = 0
const account = (userId: string, providerId: string) =>
  t.db.insert(schema.account).values({
    id: `acc-${(n += 1)}`,
    accountId: `ext-${n}`,
    providerId,
    userId,
    updatedAt: new Date(),
  })

describe('listMemberSignIn', () => {
  it("lists each member's methods from their accounts: password first, own SSO as sso", async () => {
    const { workspace, owner } = await seedWorkspace(t.db)
    const both = await seedUser(t.db)
    const none = await seedUser(t.db)
    const outsider = await seedUser(t.db)
    await Promise.all(
      [both, none].map((u) => addTestMember(t.db, { workspaceId: workspace.id, userId: u.id })),
    )
    await t.db.insert(schema.ssoProvider).values({
      id: 'sso-1',
      issuer: 'https://idp.acme.test',
      providerId: 'acme-okta',
      domain: 'acme.test',
      userId: owner.id,
      workspaceId: workspace.id,
    })
    await account(owner.id, 'credential')
    await account(owner.id, 'acme-okta')
    await account(both.id, 'github')
    await account(both.id, 'credential')
    await account(both.id, 'google')
    await account(outsider.id, 'github')

    const result = await listMemberSignIn(t.db, workspace.id)
    const by = Object.fromEntries(result.map((r) => [r.userId, r.methods]))
    expect(by[owner.id]).toEqual(['password', 'sso'])
    expect(by[both.id]).toEqual(['password', 'github', 'google'])
    // Signs in by emailed code only (or not yet at all): no linked account, no method.
    expect(by[none.id]).toEqual([])
    expect(outsider.id in by).toBe(false)
  })

  it("does not count another workspace's SSO provider as this workspace's", async () => {
    const a = await seedWorkspace(t.db)
    const b = await seedWorkspace(t.db)
    await t.db.insert(schema.ssoProvider).values({
      id: 'sso-b',
      issuer: 'https://idp.b.test',
      providerId: 'b-idp',
      domain: 'b.test',
      userId: b.owner.id,
      workspaceId: b.workspace.id,
    })
    await account(a.owner.id, 'b-idp')
    const result = await listMemberSignIn(t.db, a.workspace.id)
    expect(result).toEqual([{ userId: a.owner.id, methods: ['b-idp'] }])
  })
})

describe('database status', () => {
  it('pings', async () => {
    await expect(pingDatabase(t.db)).resolves.toBeUndefined()
  })

  it('counts the migrations applied against those shipped', async () => {
    const status = await getMigrationStatus(t.db)
    expect(status.available).toBeGreaterThan(0)
    expect(status.applied).toBe(status.available)
  })
})
