import {
  createTestDb,
  imageSha,
  seedBuild,
  seedDiff,
  seedFlipFlops,
  seedMainRun,
  seedTeam,
} from '@circi/db/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { buildFlakyDecision } from '#src/repositories/index.ts'

let t: createTestDb.Result
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(async () => {
  await t.close()
})

/** A team whose `wobble` flips A, B, A, B, A on main (3 flip-flops, flaky; biggest wobble 0.05) and `steady` doesn't. */
async function flakyTeam() {
  const { team } = await seedTeam(t.db)
  await seedFlipFlops(t.db, team.id, 'wobble', ['A', 'B', 'A', 'B', 'A'], 0.05)
  await seedMainRun(t.db, team.id, { images: { steady: 'S' } })
  return team
}

async function pr(
  teamId: string,
  diffs: Record<
    string,
    {
      status: 'added' | 'removed' | 'changed' | 'unchanged' | 'failed'
      image?: string
      score?: number
      sizeChanged?: boolean
    }
  >,
) {
  const build = await seedBuild(t.db, teamId, {
    branch: 'feature',
    prNumber: 1,
    status: 'complete',
  })
  for (const [name, d] of Object.entries(diffs)) {
    // oxlint-disable-next-line no-await-in-loop -- a few rows
    await seedDiff(t.db, {
      buildId: build.id,
      name,
      status: d.status,
      ...(d.image ? { headSha256: imageSha(d.image) } : {}),
      ...(d.score === undefined ? {} : { score: d.score }),
      ...(d.sizeChanged ? { sizeChanged: true } : {}),
    })
  }
  return build
}

const wobble = (image: string, score: number, sizeChanged = false) => ({
  status: 'changed' as const,
  image,
  score,
  sizeChanged,
})

describe('buildFlakyDecision', () => {
  it('is flaky-only when the change is an image the screenshot already had on main', async () => {
    const team = await flakyTeam()
    const build = await pr(team.id, { wobble: wobble('A', 0.9, true) })
    const decision = await buildFlakyDecision(t.db, build)
    expect(decision.flakyOnly).toBe(true)
    expect(decision.flaky).toEqual([
      {
        name: 'wobble',
        reason: 'came back to an earlier image 3 times',
        knownImages: [imageSha('A'), imageSha('B')],
        largestScore: 0.05,
      },
    ])
  })

  it('is flaky-only when it is a new image that differs no more than the biggest wobble', async () => {
    const team = await flakyTeam()
    const build = await pr(team.id, { wobble: wobble('NEW', 0.03) })
    expect((await buildFlakyDecision(t.db, build)).flakyOnly).toBe(true)
  })

  it('blocks a change that breaks the layout of a flaky screenshot: bigger, or resized', async () => {
    const team = await flakyTeam()
    const big = await pr(team.id, { wobble: wobble('NEW', 0.8) })
    expect((await buildFlakyDecision(t.db, big)).flakyOnly).toBe(false)
    const resized = await pr(team.id, { wobble: wobble('NEW', 0.01, true) })
    expect((await buildFlakyDecision(t.db, resized)).flakyOnly).toBe(false)
    // The flaky set is still recorded: the screenshot is flaky, this change just isn't its wobble.
    expect((await buildFlakyDecision(t.db, big)).flaky.map((f) => f.name)).toEqual(['wobble'])
  })

  it('is false when a steady screenshot changed too', async () => {
    const team = await flakyTeam()
    const build = await pr(team.id, {
      wobble: wobble('A', 0.01),
      steady: { status: 'changed', image: 'S2', score: 0.01 },
    })
    expect((await buildFlakyDecision(t.db, build)).flakyOnly).toBe(false)
  })

  it.each(['added', 'removed', 'failed'] as const)(
    'is false when a screenshot is %s, even next to a flaky change',
    async (status) => {
      const team = await flakyTeam()
      const build = await pr(team.id, { wobble: wobble('A', 0.01), extra: { status } })
      expect((await buildFlakyDecision(t.db, build)).flakyOnly).toBe(false)
    },
  )

  it('is false without any change, and when nothing is flaky yet', async () => {
    const team = await flakyTeam()
    const same = await pr(team.id, { wobble: { status: 'unchanged', image: 'B' } })
    expect((await buildFlakyDecision(t.db, same)).flakyOnly).toBe(false)
    const { team: fresh } = await seedTeam(t.db)
    const build = await pr(fresh.id, { wobble: wobble('A', 0.01) })
    expect(await buildFlakyDecision(t.db, build)).toEqual({ flakyOnly: false, flaky: [] })
  })

  it("uses only the builds before the build: its own changes, and later main builds, don't count", async () => {
    const { team } = await seedTeam(t.db)
    await seedFlipFlops(t.db, team.id, 'wobble', ['A', 'B', 'A', 'B'], 0.05)
    // Gated here: wobble has flipped twice on main, short of the team's 3.
    const build = await pr(team.id, { wobble: wobble('B', 0.05) })
    // After it, main flips twice more. They are not what this build was judged against.
    await seedFlipFlops(t.db, team.id, 'wobble', ['A', 'B', 'A', 'B'], 0.05)
    expect(await buildFlakyDecision(t.db, build)).toEqual({ flakyOnly: false, flaky: [] })
  })

  it('does not count the gated build itself, when it is on the default branch', async () => {
    const { team } = await seedTeam(t.db)
    await seedFlipFlops(t.db, team.id, 'wobble', ['A', 'B', 'A', 'B'], 0.05)
    // A fifth main build that flips back to A would make wobble flaky, but it is the one gated.
    const [fifth] = await seedFlipFlops(t.db, team.id, 'wobble', ['A'], 0.05)
    expect(fifth).toBeDefined()
    expect((await buildFlakyDecision(t.db, fifth!)).flaky).toEqual([])
  })
})
