import {
  createBuild,
  createReviewRule,
  markFileVerified,
  planUploads,
  setTriageRotation,
} from '@circi/db/repositories'
import * as schema from '@circi/db/schema'
import { addTestMember, createTestDb, seedTeam, seedUser } from '@circi/db/testing'
import { fakeSha } from '@circi/testing'
import { asc, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { completeBuild, finalizeBuild } from '#src/index.ts'

let t: createTestDb.Result
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(async () => {
  await t.close()
})

const requestsOf = async (buildId: string) =>
  t.db
    .select()
    .from(schema.reviewRequests)
    .where(eq(schema.reviewRequests.buildId, buildId))
    .orderBy(asc(schema.reviewRequests.createdAt), asc(schema.reviewRequests.id))

/** A team with an owner and two teammates, `ann` and `bob`. */
async function setup() {
  const { team, workspace, owner } = await seedTeam(t.db)
  const ann = await seedUser(t.db)
  const bob = await seedUser(t.db)
  // oxlint-disable-next-line no-await-in-loop -- tiny fixed list
  for (const u of [ann, bob]) await addTestMember(t.db, { workspaceId: workspace.id, userId: u.id })
  return { team, workspace, owner, ann, bob }
}

let n = 0
/** Uploads a build the way CI does and finalizes one shard of it. */
async function upload(
  teamId: string,
  options: {
    names?: string[]
    name?: string
    branch?: string
    parallel?: { total: number; shard: string }
    now?: Date
    build?: Awaited<ReturnType<typeof createBuild>>
  } = {},
) {
  n += 1
  const hash = fakeSha(n.toString(16).padStart(2, '0'))
  const build =
    options.build ??
    (await createBuild(t.db, {
      teamId,
      commitSha: `abc${String(n).padStart(4, '0')}`,
      branch: options.branch ?? 'feature',
      ...(options.name ? { name: options.name } : {}),
      ...(options.parallel ? { parallel: { nonce: 'nonce', total: options.parallel.total } } : {}),
    }))
  await planUploads(t.db, {
    buildId: build.id,
    kind: 'screenshot',
    files: [{ sha256: hash, size: 10, contentType: 'image/png' }],
    storageKeyFor: (s) => `files/${s}`,
  })
  await markFileVerified(t.db, hash, { size: 10 })
  const result = await finalizeBuild(
    t.db,
    {
      buildId: build.id,
      ...(options.parallel ? { shardIndex: options.parallel.shard } : {}),
      screenshots: (options.names ?? ['home']).map((name) => ({ name, sha256: hash })),
    },
    { now: options.now ?? new Date('2026-03-11T12:00:00Z') },
  )
  return { build, result }
}

describe('finalizeBuild with review rules', () => {
  it('asks the reviewers of a matching snapshot rule when the last shard arrives', async () => {
    const { team, ann, bob } = await setup()
    await createReviewRule(t.db, {
      teamId: team.id,
      kind: 'snapshot-name',
      pattern: 'checkout/**',
      reviewerIds: [ann.id],
    })
    await createReviewRule(t.db, {
      teamId: team.id,
      kind: 'snapshot-name',
      pattern: 'admin/*',
      reviewerIds: [bob.id],
    })
    const now = new Date('2026-03-11T12:00:00Z')
    const { build } = await upload(team.id, { names: ['home', 'checkout/pay/card'], now })

    const requests = await requestsOf(build.id)
    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({
      reviewerId: ann.id,
      requestedById: null,
      state: 'open',
    })
    // The default review target is 24 hours.
    expect(requests[0]?.dueAt?.toISOString()).toBe('2026-03-12T12:00:00.000Z')
  })

  it('matches a build-name rule, and asks someone named by two rules once', async () => {
    const { team, ann, bob } = await setup()
    for (const [kind, pattern, ids] of [
      ['build-name', 'mobile-*', [ann.id, bob.id]],
      ['snapshot-name', 'home', [bob.id]],
    ] as const) {
      // oxlint-disable-next-line no-await-in-loop -- tiny fixed list
      await createReviewRule(t.db, { teamId: team.id, kind, pattern, reviewerIds: [...ids] })
    }
    const { build } = await upload(team.id, { name: 'mobile-ios' })
    const reviewers = (await requestsOf(build.id)).map((r) => r.reviewerId).toSorted()
    expect(reviewers).toEqual([ann.id, bob.id].toSorted())
  })

  it('asks nobody while shards are missing, and everyone once the last one is in', async () => {
    const { team, ann } = await setup()
    await createReviewRule(t.db, {
      teamId: team.id,
      kind: 'snapshot-name',
      pattern: '*',
      reviewerIds: [ann.id],
    })
    const first = await upload(team.id, {
      names: ['a'],
      parallel: { total: 2, shard: '0' },
    })
    expect(first.result).toMatchObject({ complete: false })
    expect(await requestsOf(first.build.id)).toHaveLength(0)

    const last = await upload(team.id, {
      names: ['b'],
      parallel: { total: 2, shard: '1' },
      build: first.build,
    })
    expect(last.result).toMatchObject({ complete: true })
    expect(await requestsOf(first.build.id)).toHaveLength(1)
  })

  it('skips a reviewer who has left the workspace', async () => {
    const { team, ann, bob } = await setup()
    await createReviewRule(t.db, {
      teamId: team.id,
      kind: 'snapshot-name',
      pattern: 'home',
      reviewerIds: [ann.id, bob.id],
    })
    await t.db.delete(schema.member).where(eq(schema.member.userId, ann.id))
    const { build } = await upload(team.id)
    expect((await requestsOf(build.id)).map((r) => r.reviewerId)).toEqual([bob.id])
  })

  it("falls back to this week's person on triage when no rule matches", async () => {
    const { team, ann, bob } = await setup()
    await createReviewRule(t.db, {
      teamId: team.id,
      kind: 'snapshot-name',
      pattern: 'admin/*',
      reviewerIds: [bob.id],
    })
    // 2026-03-09 is a Monday: ann's week; bob has the next one.
    await setTriageRotation(t.db, {
      teamId: team.id,
      memberIds: [ann.id, bob.id],
      startsOn: new Date('2026-03-09T00:00:00Z'),
    })
    const thisWeek = await upload(team.id, { now: new Date('2026-03-11T12:00:00Z') })
    expect((await requestsOf(thisWeek.build.id)).map((r) => r.reviewerId)).toEqual([ann.id])
    // A newer build asks next week's person; the rotation's own request isn't repeated.
    const nextWeek = await upload(team.id, { now: new Date('2026-03-16T00:00:00Z') })
    expect((await requestsOf(nextWeek.build.id)).map((r) => r.reviewerId)).toEqual([bob.id])
  })

  it('prefers a matching rule over the rotation', async () => {
    const { team, ann, bob } = await setup()
    await createReviewRule(t.db, {
      teamId: team.id,
      kind: 'snapshot-name',
      pattern: 'home',
      reviewerIds: [bob.id],
    })
    await setTriageRotation(t.db, {
      teamId: team.id,
      memberIds: [ann.id],
      startsOn: new Date('2026-03-09T00:00:00Z'),
    })
    const { build } = await upload(team.id)
    expect((await requestsOf(build.id)).map((r) => r.reviewerId)).toEqual([bob.id])
  })

  it('asks nobody with no matching rule and no rotation', async () => {
    const { team, bob } = await setup()
    await createReviewRule(t.db, {
      teamId: team.id,
      kind: 'snapshot-name',
      pattern: 'admin/*',
      reviewerIds: [bob.id],
    })
    const { build } = await upload(team.id)
    expect(await requestsOf(build.id)).toHaveLength(0)
  })

  it("closes a superseded build's request when a newer build on the branch arrives", async () => {
    const { team, ann } = await setup()
    await createReviewRule(t.db, {
      teamId: team.id,
      kind: 'snapshot-name',
      pattern: 'home',
      reviewerIds: [ann.id],
    })
    const older = await upload(team.id, { branch: 'feature/x' })
    const newer = await upload(team.id, { branch: 'feature/x' })
    expect((await requestsOf(older.build.id)).map((r) => r.state)).toEqual(['superseded'])
    expect((await requestsOf(newer.build.id)).map((r) => r.state)).toEqual(['open'])
  })

  it('closes the requests of a build that turns out to have no changes', async () => {
    const { team, ann } = await setup()
    await createReviewRule(t.db, {
      teamId: team.id,
      kind: 'snapshot-name',
      pattern: 'home',
      reviewerIds: [ann.id],
    })
    const { build } = await upload(team.id)
    const [processing] = await t.db
      .select()
      .from(schema.builds)
      .where(eq(schema.builds.id, build.id))
    if (!processing) throw new Error('build missing')
    await completeBuild(t.db, processing, { conclusion: 'no_changes', approval: 'none' })
    expect((await requestsOf(build.id)).map((r) => r.state)).toEqual(['done'])
  })
})
