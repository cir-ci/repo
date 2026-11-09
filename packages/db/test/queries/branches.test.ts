import { createTestDb, seedBuild, seedTeam, seedUser } from '@circi/db/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { listBranches, listBuildsForTeam } from '#src/queries/index.ts'

let t: createTestDb.Result
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(async () => {
  await t.close()
})

const at = (n: number) => new Date(Date.UTC(2026, 0, 1, 0, 0, n))

/** Builds on branches in the order given (oldest first), in a workspace of two teams. */
async function history(branches: (string | null)[]) {
  const web = await seedTeam(t.db, { slug: 'web' })
  const docs = await seedTeam(t.db, { slug: 'docs', workspace: web })
  let n = 0
  for (const branch of branches) {
    n += 1
    // oxlint-disable-next-line no-await-in-loop -- tiny fixed list
    await seedBuild(t.db, web.team.id, { branch, createdAt: at(n) })
  }
  await seedBuild(t.db, docs.team.id, { branch: 'docs/guide', createdAt: at(100) })
  return { web, docs, workspace: web.workspace, owner: web.owner }
}

describe('listBranches', () => {
  it('lists each branch of a team once, the most recently built first', async () => {
    const { workspace, owner } = await history(['main', 'qa/pr20', 'feature/a', 'main', null])
    const found = await listBranches(t.db, {
      userId: owner.id,
      workspaceSlug: workspace.slug,
      teamSlug: 'web',
    })
    expect(found?.map((b) => b.name)).toEqual(['main', 'feature/a', 'qa/pr20'])
    expect(found?.[0]?.lastBuildAt).toEqual(at(4))
  })

  it('covers every team of the workspace without a team, and the branches of one with', async () => {
    const { workspace, owner } = await history(['main'])
    const all = await listBranches(t.db, { userId: owner.id, workspaceSlug: workspace.slug })
    expect(all?.map((b) => b.name)).toEqual(['docs/guide', 'main'])
  })

  it('matches what is typed anywhere in the name, ignoring case and treating % and _ as text', async () => {
    const { workspace, owner } = await history(['qa/pr20', 'feature/QA-login', 'main', '100%_done'])
    const input = { userId: owner.id, workspaceSlug: workspace.slug, teamSlug: 'web' }
    expect((await listBranches(t.db, { ...input, query: 'qa' }))?.map((b) => b.name)).toEqual([
      'feature/QA-login',
      'qa/pr20',
    ])
    expect((await listBranches(t.db, { ...input, query: 'PR2' }))?.map((b) => b.name)).toEqual([
      'qa/pr20',
    ])
    expect((await listBranches(t.db, { ...input, query: '%_' }))?.map((b) => b.name)).toEqual([
      '100%_done',
    ])
    expect(await listBranches(t.db, { ...input, query: 'nothing' })).toEqual([])
  })

  it('stops at the limit, keeping the most recent', async () => {
    const { workspace, owner } = await history(['a', 'b', 'c', 'd'])
    const found = await listBranches(t.db, {
      userId: owner.id,
      workspaceSlug: workspace.slug,
      teamSlug: 'web',
      limit: 2,
    })
    expect(found?.map((b) => b.name)).toEqual(['d', 'c'])
  })

  it('is undefined for a stranger, an unknown workspace or an unknown team', async () => {
    const { workspace, owner } = await history(['main'])
    const stranger = await seedUser(t.db)
    expect(
      await listBranches(t.db, { userId: stranger.id, workspaceSlug: workspace.slug }),
    ).toBeUndefined()
    expect(await listBranches(t.db, { userId: owner.id, workspaceSlug: 'nope' })).toBeUndefined()
    expect(
      await listBranches(t.db, { userId: owner.id, workspaceSlug: workspace.slug, teamSlug: 'x' }),
    ).toBeUndefined()
  })
})

describe('the builds list branch filters', () => {
  it('`branch` is an exact match and `branchContains` a case-insensitive substring', async () => {
    const { web } = await history(['qa/pr20', 'qa/pr21', 'main', 'feature/QA'])
    const numbers = async (filters: listBuildsForTeam.Filters) =>
      (await listBuildsForTeam(t.db, web.team.id, { limit: 50, filters }))
        .map((b) => b.branch ?? '')
        .toSorted((a, b) => a.localeCompare(b))
    expect(await numbers({ branch: 'qa' })).toEqual([])
    expect(await numbers({ branch: 'qa/pr20' })).toEqual(['qa/pr20'])
    expect(await numbers({ branchContains: 'qa' })).toEqual(['feature/QA', 'qa/pr20', 'qa/pr21'])
    expect(await numbers({ branchContains: 'PR2' })).toEqual(['qa/pr20', 'qa/pr21'])
    expect(await numbers({ branchContains: 'qa', reviewStatus: 'approved' })).toEqual([])
  })
})
