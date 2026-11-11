import { ConflictError, NotFoundError } from '@circi/db'
import { markWorkspaceDeleted } from '@circi/db/repositories'
import { createTestDb, seedProject } from '@circi/db/testing'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { joinWorkspace } from '#src/index.ts'

let t: createTestDb.Result
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(async () => {
  await t.close()
})

describe('joinWorkspace', () => {
  it('writes the membership (through apply) for an instance admin who is not in it', async () => {
    const { workspace } = await seedProject(t.db)
    const apply = vi.fn<() => Promise<void>>(async () => {})
    await joinWorkspace(t.db, {
      actor: { instanceAdmin: true },
      workspaceId: workspace.id,
      userId: 'someone',
      apply,
    })
    expect(apply).toHaveBeenCalledOnce()
  })

  it('refuses anyone who is not an instance admin, before touching anything', async () => {
    const { workspace } = await seedProject(t.db)
    const apply = vi.fn<() => Promise<void>>(async () => {})
    await expect(
      joinWorkspace(t.db, {
        actor: { instanceAdmin: false },
        workspaceId: workspace.id,
        userId: 'someone',
        apply,
      }),
    ).rejects.toThrow('Only instance admins can do this')
    expect(apply).not.toHaveBeenCalled()
  })

  it('conflicts when they are already a member', async () => {
    const { workspace, owner } = await seedProject(t.db)
    const apply = vi.fn<() => Promise<void>>(async () => {})
    await expect(
      joinWorkspace(t.db, {
        actor: { instanceAdmin: true },
        workspaceId: workspace.id,
        userId: owner.id,
        apply,
      }),
    ).rejects.toBeInstanceOf(ConflictError)
    expect(apply).not.toHaveBeenCalled()
  })

  it('answers not found for a missing or deleted workspace', async () => {
    const { workspace, owner } = await seedProject(t.db)
    const input = { actor: { instanceAdmin: true }, userId: 'someone', apply: async () => {} }
    await expect(joinWorkspace(t.db, { ...input, workspaceId: 'nope' })).rejects.toBeInstanceOf(
      NotFoundError,
    )
    await markWorkspaceDeleted(t.db, {
      workspaceId: workspace.id,
      deletedBy: owner.id,
      now: new Date(),
    })
    await expect(
      joinWorkspace(t.db, { ...input, workspaceId: workspace.id }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })
})
