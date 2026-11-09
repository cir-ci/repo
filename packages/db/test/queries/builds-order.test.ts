import { BUILD_ORDERS, type BuildOrder } from '@circi/core'
import { createTestDb, seedBuild, seedTeam } from '@circi/db/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { listBuildsForTeam, listBuildsForWorkspace } from '#src/queries/index.ts'
import { createTeam } from '#src/repositories/index.ts'

let t: createTestDb.Result
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(async () => {
  await t.close()
})

const at = (n: number) => new Date(Date.UTC(2026, 0, 1, 0, 0, n))

interface Spec {
  at: number
  status?: 'processing' | 'error' | 'expired'
  changes?: number
  review?: 'pending' | 'approved' | 'rejected'
  /** Sort position of `status`, smallest first. */
  rank: number
}
// Pairs of builds share a timestamp, so a page boundary can fall between two of them.
const SPECS: Spec[] = [
  { at: 0, rank: 5 }, // 1: complete, nothing changed
  { at: 0, changes: 3, review: 'pending', rank: 2 }, // 2
  { at: 1, changes: 3, review: 'approved', rank: 4 }, // 3
  { at: 1, status: 'error', rank: 1 }, // 4
  { at: 2, changes: 1, review: 'rejected', rank: 3 }, // 5
  { at: 2, status: 'processing', rank: 0 }, // 6
  { at: 3, status: 'expired', rank: 6 }, // 7
  { at: 3, changes: 1, review: 'pending', rank: 2 }, // 8
]

interface Made extends Spec {
  id: string
  number: number
  created: Date
}

async function seed(teamId: string): Promise<Made[]> {
  const made: Made[] = []
  for (const spec of SPECS) {
    // eslint-disable-next-line no-await-in-loop -- numbering is sequential
    const build = await seedBuild(t.db, teamId, {
      createdAt: at(spec.at),
      status: spec.status ?? 'complete',
      ...(spec.status ? {} : { conclusion: spec.changes ? 'changes_detected' : 'no_changes' }),
      ...(spec.review ? { reviewStatus: spec.review } : {}),
      ...(spec.changes
        ? { changedSnapshots: Array.from({ length: spec.changes }, (_, i) => `s${i}`) }
        : {}),
    })
    made.push({ ...spec, id: build.id, number: build.number, created: at(spec.at) })
  }
  return made
}

const cmp = (a: number | string, b: number | string) => (a < b ? -1 : a > b ? 1 : 0)

/** What each order should give, worked out here and not by the query. */
function expected(order: BuildOrder, rows: Made[], tie: (m: Made) => (number | string)[]) {
  const tieCmp = (a: Made, b: Made) => {
    const [x, y] = [tie(a), tie(b)]
    for (const [i, v] of x.entries()) {
      const c = cmp(v, y[i] ?? 0)
      if (c !== 0) return c
    }
    return 0
  }
  const sorted = rows.toSorted((a, b) => {
    if (order === 'oldest') return tieCmp(a, b)
    if (order === 'newest') return tieCmp(b, a)
    if (order === 'most-changes') return cmp(b.changes ?? 0, a.changes ?? 0) || tieCmp(b, a)
    return cmp(a.rank, b.rank) || tieCmp(b, a)
  })
  return sorted.map((m) => m.id)
}

const LIMIT = 3

describe.each(BUILD_ORDERS)('builds ordered by %s', (order) => {
  it('pages through a team’s builds without repeats or gaps, across same-time ties', async () => {
    const { team } = await seedTeam(t.db)
    const made = await seed(team.id)
    const ids: string[] = []
    let before: number | undefined
    for (let page = 0; page < 10; page += 1) {
      // eslint-disable-next-line no-await-in-loop -- each page needs the one before
      const items = await listBuildsForTeam(t.db, team.id, {
        limit: LIMIT,
        order,
        ...(before === undefined ? {} : { beforeNumber: before }),
      })
      ids.push(...items.map((b) => b.id))
      if (items.length < LIMIT) break
      before = items.at(-1)?.number
    }
    expect(ids).toEqual(expected(order, made, (m) => [m.number]))
  })

  it('pages through a workspace’s builds, across teams and same-time ties', async () => {
    const seeded = await seedTeam(t.db)
    const second = await createTeam(t.db, { workspaceSlug: seeded.workspace.slug, name: 'mobile' })
    const made = [...(await seed(seeded.team.id)), ...(await seed(second.id))]
    const ids: string[] = []
    let before: string | undefined
    for (let page = 0; page < 10; page += 1) {
      // eslint-disable-next-line no-await-in-loop -- each page needs the one before
      const found = await listBuildsForWorkspace(t.db, {
        userId: seeded.owner.id,
        workspaceSlug: seeded.workspace.slug,
        limit: LIMIT,
        order,
        ...(before === undefined ? {} : { before }),
      })
      const items = found?.builds ?? []
      ids.push(...items.map((b) => b.id))
      if (items.length < LIMIT) break
      before = items.at(-1)?.id
    }
    expect(ids).toEqual(expected(order, made, (m) => [m.created.getTime(), m.id]))
  })
})

describe('builds order', () => {
  it('starts with the newest by default, and the first page differs per order', async () => {
    const { team } = await seedTeam(t.db)
    const made = await seed(team.id)
    const first = async (order?: BuildOrder) =>
      (await listBuildsForTeam(t.db, team.id, { limit: 1, ...(order ? { order } : {}) }))[0]?.id
    const byNumber = (n: number) => made.find((m) => m.number === n)?.id
    expect(await first()).toBe(byNumber(8))
    expect(await first('oldest')).toBe(byNumber(1))
    expect(await first('most-changes')).toBe(byNumber(3)) // 3 changes, the higher number of the two
    expect(await first('status')).toBe(byNumber(6)) // still processing
  })

  it('keeps a number cursor that names no build working for newest and oldest', async () => {
    const { team } = await seedTeam(t.db)
    await seed(team.id)
    const items = await listBuildsForTeam(t.db, team.id, { limit: 50, beforeNumber: 100 })
    expect(items).toHaveLength(8)
  })
})
