import { ConflictError, NotFoundError } from '@circi/db'
import { listPinnedTeamIds, listSavedViews } from '@circi/db/queries'
import { addTestMember, createTestDb, seedTeam, seedUser } from '@circi/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  createView,
  deleteView,
  pinTeam,
  renameView,
  reorderViews,
  setViewPinned,
  unpinTeam,
  updateView,
  updateViewFilters,
} from '#src/index.ts'

let t: createTestDb.Result
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(async () => {
  await t.close()
})

async function setup() {
  const { team, workspace, owner } = await seedTeam(t.db)
  const mate = await seedUser(t.db)
  await addTestMember(t.db, { workspaceId: workspace.id, userId: mate.id })
  const mine = { userId: owner.id, workspaceId: workspace.id }
  return { team, workspace, owner, mate, mine }
}

describe('saved views', () => {
  it('creates views in order, with and without a team', async () => {
    const { team, mine } = await setup()
    const a = await createView(t.db, { ...mine, name: 'Failing', filters: { status: 'error' } })
    const b = await createView(t.db, {
      ...mine,
      name: 'Mine',
      teamId: team.id,
      filters: { author: 'me' },
    })
    expect(a).toMatchObject({ name: 'Failing', position: 0, pinned: false, team: null })
    expect(b).toMatchObject({ position: 1, team: { slug: team.slug } })
    expect((await listSavedViews(t.db, mine)).map((v) => v.name)).toEqual(['Failing', 'Mine'])
  })

  it('keeps a name unique per person and workspace', async () => {
    const { mine, mate, workspace } = await setup()
    await createView(t.db, { ...mine, name: 'Same', filters: {} })
    await expect(createView(t.db, { ...mine, name: ' Same ', filters: {} })).rejects.toBeInstanceOf(
      ConflictError,
    )
    // Someone else may use the name.
    await createView(t.db, {
      userId: mate.id,
      workspaceId: workspace.id,
      name: 'Same',
      filters: {},
    })
    const other = await createView(t.db, { ...mine, name: 'Other', filters: {} })
    await expect(renameView(t.db, { ...mine, id: other.id, name: 'Same' })).rejects.toBeInstanceOf(
      ConflictError,
    )
    await expect(createView(t.db, { ...mine, name: '  ', filters: {} })).rejects.toThrow(/name/)
  })

  it('refuses a team from another workspace', async () => {
    const { mine } = await setup()
    const { team: foreign } = await seedTeam(t.db)
    await expect(
      createView(t.db, { ...mine, name: 'x', teamId: foreign.id, filters: {} }),
    ).rejects.toThrow(/not in this workspace/)
  })

  it('renames, changes filters, pins and unpins', async () => {
    const { mine } = await setup()
    const v = await createView(t.db, { ...mine, name: 'Old', filters: { status: 'error' } })
    expect((await renameView(t.db, { ...mine, id: v.id, name: 'New' })).name).toBe('New')
    expect(
      (await updateViewFilters(t.db, { ...mine, id: v.id, filters: { review: 'pending' } }))
        .filters,
    ).toEqual({ review: 'pending' })
    expect((await setViewPinned(t.db, { ...mine, id: v.id, pinned: true })).pinned).toBe(true)
    expect(
      await updateView(t.db, { ...mine, id: v.id, pinned: false, name: 'Both' }),
    ).toMatchObject({ pinned: false, name: 'Both', filters: { review: 'pending' } })
  })

  it("is the owner's only: someone else's view is not found", async () => {
    const { mine, mate, workspace } = await setup()
    const v = await createView(t.db, { ...mine, name: 'Private', filters: {} })
    const theirs = { userId: mate.id, workspaceId: workspace.id, id: v.id }
    await expect(renameView(t.db, { ...theirs, name: 'Hijack' })).rejects.toBeInstanceOf(
      NotFoundError,
    )
    await expect(setViewPinned(t.db, { ...theirs, pinned: true })).rejects.toBeInstanceOf(
      NotFoundError,
    )
    await expect(deleteView(t.db, theirs)).rejects.toBeInstanceOf(NotFoundError)
    expect(await listSavedViews(t.db, { userId: mate.id, workspaceId: workspace.id })).toEqual([])
    expect(await listSavedViews(t.db, mine)).toHaveLength(1)
  })

  it('reorders, and refuses a list that is not exactly the views', async () => {
    const { mine } = await setup()
    const a = await createView(t.db, { ...mine, name: 'a', filters: {} })
    const b = await createView(t.db, { ...mine, name: 'b', filters: {} })
    const c = await createView(t.db, { ...mine, name: 'c', filters: {} })
    const out = await reorderViews(t.db, { ...mine, ids: [c.id, a.id, b.id] })
    expect(out.map((v) => v.name)).toEqual(['c', 'a', 'b'])
    await expect(reorderViews(t.db, { ...mine, ids: [a.id, b.id] })).rejects.toThrow(/every one/)
    await expect(reorderViews(t.db, { ...mine, ids: [a.id, a.id, b.id] })).rejects.toThrow(
      /every one/,
    )
  })

  it('deletes', async () => {
    const { mine } = await setup()
    const v = await createView(t.db, { ...mine, name: 'gone', filters: {} })
    await deleteView(t.db, { ...mine, id: v.id })
    expect(await listSavedViews(t.db, mine)).toEqual([])
    await expect(deleteView(t.db, { ...mine, id: v.id })).rejects.toBeInstanceOf(NotFoundError)
  })
})

describe('pinned teams', () => {
  it('pins in order, reports what changed, and unpins', async () => {
    const { team, workspace, owner } = await setup()
    const second = await seedTeam(t.db, { workspace: { workspace, owner }, slug: 'second' })
    const input = { userId: owner.id }
    expect(await pinTeam(t.db, { ...input, teamId: second.team.id })).toBe(true)
    expect(await pinTeam(t.db, { ...input, teamId: team.id })).toBe(true)
    expect(await pinTeam(t.db, { ...input, teamId: team.id })).toBe(false)
    expect(await listPinnedTeamIds(t.db, owner.id)).toEqual([second.team.id, team.id])
    expect(await unpinTeam(t.db, { ...input, teamId: second.team.id })).toBe(true)
    expect(await unpinTeam(t.db, { ...input, teamId: second.team.id })).toBe(false)
    expect(await listPinnedTeamIds(t.db, owner.id)).toEqual([team.id])
  })
})
