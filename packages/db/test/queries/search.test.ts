import {
  addTestMember,
  createTestDb,
  seedBuild,
  seedTeam,
  seedReviewRequest,
  seedScreenshot,
  seedUser,
} from '@circi/db/testing'
import { fakeSha } from '@circi/testing'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { listBuildsForTeam, searchWorkspace } from '#src/queries/index.ts'
import * as schema from '#src/schema/index.ts'

let t: createTestDb.Result
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(async () => {
  await t.close()
})

const at = (iso: string) => new Date(iso)
const done = { status: 'complete', conclusion: 'changes_detected' } as const

describe('searchWorkspace', () => {
  it('groups builds, branches, teams and snapshots, scoped to the workspace', async () => {
    const { team, workspace, owner } = await seedTeam(t.db, { slug: 'checkout-web' })
    const rival = await seedTeam(t.db, { slug: 'checkout-rival' })
    let last = 0
    for (let i = 0; i < 148; i += 1) {
      // eslint-disable-next-line no-await-in-loop -- sequential numbering
      const b = await seedBuild(t.db, team.id, {
        branch: i === 147 ? 'feature/checkout-redesign' : 'main',
        ...(i === 147 ? { prNumber: 7 } : {}),
      })
      last = b.number
    }
    expect(last).toBe(148)
    const b148 = await t.db.query.builds.findFirst({
      where: eq(schema.builds.number, 148),
    })
    await seedScreenshot(t.db, {
      buildId: b148!.id,
      name: 'checkout-page',
      fileSha256: fakeSha('a'),
    })
    const rivalBuild = await seedBuild(t.db, rival.team.id, { branch: 'feature/checkout-x' })
    await seedScreenshot(t.db, {
      buildId: rivalBuild.id,
      name: 'checkout-rival-shot',
      fileSha256: fakeSha('b'),
    })

    const input = { userId: owner.id, workspaceSlug: workspace.slug }
    const hash = await searchWorkspace(t.db, { ...input, query: '#148' })
    expect(hash?.builds).toMatchObject([{ teamSlug: 'checkout-web', number: 148 }])
    const bare = await searchWorkspace(t.db, { ...input, query: '148' })
    expect(bare?.builds.map((b) => b.number)).toEqual([148])
    const pr = await searchWorkspace(t.db, { ...input, query: '7' })
    expect(pr?.builds.map((b) => [b.number, b.prNumber])).toEqual([
      [148, 7],
      [7, null],
    ])

    const text = await searchWorkspace(t.db, { ...input, query: 'CHECKOUT' })
    expect(text?.teams.map((p) => p.slug)).toEqual(['checkout-web'])
    expect(text?.branches).toMatchObject([
      { teamSlug: 'checkout-web', branch: 'feature/checkout-redesign', latestBuildNumber: 148 },
    ])
    expect(text?.snapshots).toMatchObject([
      { teamSlug: 'checkout-web', name: 'checkout-page', latestBuildNumber: 148 },
    ])
    expect(text?.builds).toEqual([])
  })

  it('limits each group, matches wildcards literally and ignores a blank query', async () => {
    const { team, workspace, owner } = await seedTeam(t.db, { slug: 'lim' })
    for (let i = 0; i < 4; i += 1) {
      // eslint-disable-next-line no-await-in-loop -- sequential numbering
      await seedBuild(t.db, team.id, { branch: `rel_${i}` })
    }
    const input = { userId: owner.id, workspaceSlug: workspace.slug }
    expect(
      (await searchWorkspace(t.db, { ...input, query: 'rel', limit: 2 }))?.branches,
    ).toHaveLength(2)
    expect((await searchWorkspace(t.db, { ...input, query: 'rel_' }))?.branches).toHaveLength(4)
    expect((await searchWorkspace(t.db, { ...input, query: 'rel%' }))?.branches).toHaveLength(0)
    expect(await searchWorkspace(t.db, { ...input, query: '  ' })).toMatchObject({
      builds: [],
      branches: [],
      teams: [],
      snapshots: [],
    })
  })

  it('is undefined for a non-member and an unknown workspace', async () => {
    const { workspace } = await seedTeam(t.db)
    const stranger = await seedUser(t.db)
    expect(
      await searchWorkspace(t.db, {
        userId: stranger.id,
        workspaceSlug: workspace.slug,
        query: 'a',
      }),
    ).toBeUndefined()
    const { owner } = await seedTeam(t.db)
    expect(
      await searchWorkspace(t.db, { userId: owner.id, workspaceSlug: 'nope', query: 'a' }),
    ).toBeUndefined()
    await addTestMember(t.db, { workspaceId: workspace.id, userId: stranger.id })
    expect(
      await searchWorkspace(t.db, {
        userId: stranger.id,
        workspaceSlug: workspace.slug,
        query: 'a',
      }),
    ).toBeDefined()
  })
})

describe('listBuildsForTeam filters', () => {
  it('filters by status, review, branch, author, reviewer, name and date', async () => {
    const { team, workspace, owner } = await seedTeam(t.db)
    const mate = await seedUser(t.db)
    await addTestMember(t.db, { workspaceId: workspace.id, userId: mate.id })
    const b1 = await seedBuild(t.db, team.id, {
      ...done,
      branch: 'main',
      reviewStatus: 'approved',
      createdAt: at('2026-03-01T10:00:00Z'),
    })
    const b2 = await seedBuild(t.db, team.id, {
      ...done,
      branch: 'feature',
      name: 'mobile',
      createdAt: at('2026-03-05T10:00:00Z'),
    })
    const b3 = await seedBuild(t.db, team.id, {
      status: 'error',
      branch: 'feature',
      createdAt: at('2026-03-10T10:00:00Z'),
    })
    await t.db
      .update(schema.builds)
      .set({ authorLogin: 'Octocat' })
      .where(eq(schema.builds.id, b2.id))
    await t.db
      .update(schema.builds)
      .set({ authorUserId: mate.id })
      .where(eq(schema.builds.id, b3.id))
    await seedReviewRequest(t.db, { buildId: b2.id, reviewerId: owner.id })
    await seedReviewRequest(t.db, { buildId: b1.id, reviewerId: owner.id, state: 'done' })

    const numbers = async (filters: Parameters<typeof listBuildsForTeam>[2]['filters']) =>
      (await listBuildsForTeam(t.db, team.id, { limit: 10, filters })).map((b) => b.number)

    expect(await numbers(undefined)).toEqual([3, 2, 1])
    expect(await numbers({})).toEqual([3, 2, 1])
    expect(await numbers({ status: 'error' })).toEqual([3])
    expect(await numbers({ reviewStatus: 'approved' })).toEqual([1])
    expect(await numbers({ branch: 'feature' })).toEqual([3, 2])
    expect(await numbers({ author: 'octocat' })).toEqual([2])
    expect(await numbers({ author: mate.id })).toEqual([3])
    expect(await numbers({ reviewer: owner.id })).toEqual([2])
    expect(await numbers({ reviewer: mate.id })).toEqual([])
    expect(await numbers({ name: 'mobile' })).toEqual([2])
    expect(
      await numbers({ from: at('2026-03-02T00:00:00Z'), to: at('2026-03-10T00:00:00Z') }),
    ).toEqual([2])
    expect(await numbers({ branch: 'feature', status: 'complete' })).toEqual([2])
  })
})
