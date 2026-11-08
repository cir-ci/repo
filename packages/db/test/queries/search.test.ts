import {
  addTestMember,
  createTestDb,
  seedBuild,
  seedProject,
  seedReviewRequest,
  seedScreenshot,
  seedUser,
  sha,
} from '@circi/testing'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { listBuildsForProject, schema, searchOrganization } from '#src/index.ts'

let t: createTestDb.Result
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(async () => {
  await t.close()
})

const at = (iso: string) => new Date(iso)
const done = { status: 'complete', conclusion: 'changes_detected' } as const

describe('searchOrganization', () => {
  it('groups builds, branches, projects and snapshots, scoped to the organization', async () => {
    const { project, org, owner } = await seedProject(t.db, { slug: 'checkout-web' })
    const rival = await seedProject(t.db, { slug: 'checkout-rival' })
    let last = 0
    for (let i = 0; i < 148; i += 1) {
      // eslint-disable-next-line no-await-in-loop -- sequential numbering
      const b = await seedBuild(t.db, project.id, {
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
      fileSha256: sha('a'),
    })
    const rivalBuild = await seedBuild(t.db, rival.project.id, { branch: 'feature/checkout-x' })
    await seedScreenshot(t.db, {
      buildId: rivalBuild.id,
      name: 'checkout-rival-shot',
      fileSha256: sha('b'),
    })

    const input = { userId: owner.id, orgSlug: org.slug }
    const hash = await searchOrganization(t.db, { ...input, query: '#148' })
    expect(hash?.builds).toMatchObject([{ projectSlug: 'checkout-web', number: 148 }])
    const bare = await searchOrganization(t.db, { ...input, query: '148' })
    expect(bare?.builds.map((b) => b.number)).toEqual([148])
    const pr = await searchOrganization(t.db, { ...input, query: '7' })
    expect(pr?.builds.map((b) => [b.number, b.prNumber])).toEqual([
      [148, 7],
      [7, null],
    ])

    const text = await searchOrganization(t.db, { ...input, query: 'CHECKOUT' })
    expect(text?.projects.map((p) => p.slug)).toEqual(['checkout-web'])
    expect(text?.branches).toMatchObject([
      { projectSlug: 'checkout-web', branch: 'feature/checkout-redesign', latestBuildNumber: 148 },
    ])
    expect(text?.snapshots).toMatchObject([
      { projectSlug: 'checkout-web', name: 'checkout-page', latestBuildNumber: 148 },
    ])
    expect(text?.builds).toEqual([])
  })

  it('limits each group, matches wildcards literally and ignores a blank query', async () => {
    const { project, org, owner } = await seedProject(t.db, { slug: 'lim' })
    for (let i = 0; i < 4; i += 1) {
      // eslint-disable-next-line no-await-in-loop -- sequential numbering
      await seedBuild(t.db, project.id, { branch: `rel_${i}` })
    }
    const input = { userId: owner.id, orgSlug: org.slug }
    expect(
      (await searchOrganization(t.db, { ...input, query: 'rel', limit: 2 }))?.branches,
    ).toHaveLength(2)
    expect((await searchOrganization(t.db, { ...input, query: 'rel_' }))?.branches).toHaveLength(4)
    expect((await searchOrganization(t.db, { ...input, query: 'rel%' }))?.branches).toHaveLength(0)
    expect(await searchOrganization(t.db, { ...input, query: '  ' })).toMatchObject({
      builds: [],
      branches: [],
      projects: [],
      snapshots: [],
    })
  })

  it('is undefined for a non-member and an unknown organization', async () => {
    const { org } = await seedProject(t.db)
    const stranger = await seedUser(t.db)
    expect(
      await searchOrganization(t.db, { userId: stranger.id, orgSlug: org.slug, query: 'a' }),
    ).toBeUndefined()
    const { owner } = await seedProject(t.db)
    expect(
      await searchOrganization(t.db, { userId: owner.id, orgSlug: 'nope', query: 'a' }),
    ).toBeUndefined()
    await addTestMember(t.db, { orgId: org.id, userId: stranger.id })
    expect(
      await searchOrganization(t.db, { userId: stranger.id, orgSlug: org.slug, query: 'a' }),
    ).toBeDefined()
  })
})

describe('listBuildsForProject filters', () => {
  it('filters by status, review, branch, author, reviewer, name and date', async () => {
    const { project, org, owner } = await seedProject(t.db)
    const mate = await seedUser(t.db)
    await addTestMember(t.db, { orgId: org.id, userId: mate.id })
    const b1 = await seedBuild(t.db, project.id, {
      ...done,
      branch: 'main',
      reviewStatus: 'approved',
      createdAt: at('2026-03-01T10:00:00Z'),
    })
    const b2 = await seedBuild(t.db, project.id, {
      ...done,
      branch: 'feature',
      name: 'mobile',
      createdAt: at('2026-03-05T10:00:00Z'),
    })
    const b3 = await seedBuild(t.db, project.id, {
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

    const numbers = async (filters: Parameters<typeof listBuildsForProject>[2]['filters']) =>
      (await listBuildsForProject(t.db, project.id, { limit: 10, filters })).map((b) => b.number)

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
