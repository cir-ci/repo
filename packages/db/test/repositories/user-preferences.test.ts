import { addTestMember, createTestDb, seedWorkspace } from '@circi/db/testing'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { getLastWorkspaceSlug } from '#src/queries/index.ts'
import { rememberLastWorkspace } from '#src/repositories/index.ts'
import { member, userPreferences, workspace, workspaceDeletions } from '#src/schema/index.ts'

let t: createTestDb.Result
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(async () => {
  await t.close()
})

describe('the remembered workspace', () => {
  it('is null until one is remembered, then the latest one', async () => {
    const one = await seedWorkspace(t.db)
    const two = await seedWorkspace(t.db)
    await addTestMember(t.db, {
      workspaceId: two.workspace.id,
      userId: one.owner.id,
      role: 'member',
    })
    expect(await getLastWorkspaceSlug(t.db, one.owner.id)).toBeNull()

    expect(
      await rememberLastWorkspace(t.db, { userId: one.owner.id, workspaceId: one.workspace.id }),
    ).toEqual({ changed: true })
    expect(await getLastWorkspaceSlug(t.db, one.owner.id)).toBe(one.workspace.slug)

    expect(
      await rememberLastWorkspace(t.db, { userId: one.owner.id, workspaceId: two.workspace.id }),
    ).toEqual({ changed: true })
    expect(await getLastWorkspaceSlug(t.db, one.owner.id)).toBe(two.workspace.slug)
  })

  it('writes nothing when the workspace is already the remembered one', async () => {
    const one = await seedWorkspace(t.db)
    const input = { userId: one.owner.id, workspaceId: one.workspace.id }
    await rememberLastWorkspace(t.db, input)
    const read = () =>
      t.db.select().from(userPreferences).where(eq(userPreferences.userId, input.userId))
    const [before] = await read()
    expect(await rememberLastWorkspace(t.db, input)).toEqual({ changed: false })
    const [after] = await read()
    expect(after?.updatedAt.getTime()).toBe(before?.updatedAt.getTime())
  })

  it('is not returned once the person has left the workspace or it was deleted', async () => {
    const one = await seedWorkspace(t.db)
    const two = await seedWorkspace(t.db)
    await addTestMember(t.db, {
      workspaceId: two.workspace.id,
      userId: one.owner.id,
      role: 'member',
    })
    await rememberLastWorkspace(t.db, { userId: one.owner.id, workspaceId: two.workspace.id })
    expect(await getLastWorkspaceSlug(t.db, one.owner.id)).toBe(two.workspace.slug)

    await t.db.delete(member).where(eq(member.workspaceId, two.workspace.id))
    expect(await getLastWorkspaceSlug(t.db, one.owner.id)).toBeNull()

    await rememberLastWorkspace(t.db, { userId: one.owner.id, workspaceId: one.workspace.id })
    await t.db.insert(workspaceDeletions).values({ workspaceId: one.workspace.id })
    expect(await getLastWorkspaceSlug(t.db, one.owner.id)).toBeNull()
  })

  it('forgets a workspace that is purged', async () => {
    const one = await seedWorkspace(t.db)
    await rememberLastWorkspace(t.db, { userId: one.owner.id, workspaceId: one.workspace.id })
    await t.db.delete(workspace).where(eq(workspace.id, one.workspace.id))
    const [row] = await t.db
      .select()
      .from(userPreferences)
      .where(eq(userPreferences.userId, one.owner.id))
    expect(row?.lastWorkspaceId).toBeNull()
    expect(await getLastWorkspaceSlug(t.db, one.owner.id)).toBeNull()
  })
})
