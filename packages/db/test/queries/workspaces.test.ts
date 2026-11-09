import { addTestMember, createTestDb, seedWorkspace, seedUser } from '@circi/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  findWorkspaceBySlug,
  findWorkspaceOwnerId,
  getMemberRole,
  getWorkspaceBySlug,
  listWorkspaces,
  listUserWorkspaceIds,
  NotFoundError,
} from '#src/index.ts'

let t: createTestDb.Result

beforeAll(async () => {
  t = await createTestDb()
})
afterAll(async () => {
  await t.close()
})

describe('workspaces and memberships (read side; better-auth owns the writes)', () => {
  it('looks workspaces up by slug', async () => {
    const { workspace } = await seedWorkspace(t.db)
    expect(await getWorkspaceBySlug(t.db, workspace.slug)).toMatchObject({ id: workspace.id })
    await expect(getWorkspaceBySlug(t.db, 'nope')).rejects.toBeInstanceOf(NotFoundError)
    expect((await listWorkspaces(t.db)).map((o) => o.slug)).toContain(workspace.slug)
  })

  it('finds a workspace by slug without throwing when there is none', async () => {
    const { workspace } = await seedWorkspace(t.db)
    expect(await findWorkspaceBySlug(t.db, workspace.slug)).toMatchObject({ id: workspace.id })
    expect(await findWorkspaceBySlug(t.db, 'nope')).toBeUndefined()
  })

  it('lists exactly the workspaces a user belongs to', async () => {
    const one = await seedWorkspace(t.db)
    const two = await seedWorkspace(t.db)
    await addTestMember(t.db, {
      workspaceId: two.workspace.id,
      userId: one.owner.id,
      role: 'member',
    })
    expect((await listUserWorkspaceIds(t.db, one.owner.id)).toSorted()).toEqual(
      [one.workspace.id, two.workspace.id].toSorted(),
    )
    expect(await listUserWorkspaceIds(t.db, two.owner.id)).toEqual([two.workspace.id])
    expect(await listUserWorkspaceIds(t.db, (await seedUser(t.db)).id)).toEqual([])
  })

  it('reports a member’s role, and nothing for non-members', async () => {
    const { workspace, owner } = await seedWorkspace(t.db)
    const dev = await seedUser(t.db)
    await addTestMember(t.db, { workspaceId: workspace.id, userId: dev.id, role: 'member' })
    expect(await getMemberRole(t.db, { userId: owner.id, workspaceId: workspace.id })).toBe('owner')
    expect(await getMemberRole(t.db, { userId: dev.id, workspaceId: workspace.id })).toBe('member')
    const outsider = await seedUser(t.db)
    expect(
      await getMemberRole(t.db, { userId: outsider.id, workspaceId: workspace.id }),
    ).toBeUndefined()
  })

  it('finds an owner to issue CI tokens on behalf of, even with admins around', async () => {
    const { workspace, owner } = await seedWorkspace(t.db)
    const admin = await seedUser(t.db)
    await addTestMember(t.db, { workspaceId: workspace.id, userId: admin.id, role: 'admin' })
    expect(await findWorkspaceOwnerId(t.db, workspace.id)).toBe(owner.id)
    expect(await findWorkspaceOwnerId(t.db, 'no-such-workspace')).toBeUndefined()
  })
})
