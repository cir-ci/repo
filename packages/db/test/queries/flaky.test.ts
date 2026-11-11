import { createTestDb, imageSha, seedFlipFlops, seedMainRun, seedProject } from '@circi/db/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  countOpenTriage,
  FLAKY_HISTORY_MAX_BUILDS,
  listFlakyScreenshots,
  listTriage,
  loadFlakyHistory,
} from '#src/queries/index.ts'
import { updateProjectsettings } from '#src/repositories/index.ts'

let t: createTestDb.Result
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(async () => {
  await t.close()
})

const now = new Date('2026-03-11T12:00:00Z')

/** A project that asks for 2 flip-flops. */
async function project2() {
  const seeded = await seedProject(t.db)
  await updateProjectsettings(t.db, seeded.project.id, { flakyAfterChanges: 2 })
  return seeded
}

describe('listFlakyScreenshots', () => {
  it('reports a screenshot that keeps returning to an earlier image, with why', async () => {
    const { project } = await project2()
    await seedFlipFlops(t.db, project.id, 'clock', ['A', 'B', 'A', 'B'])
    const report = await listFlakyScreenshots(t.db, project.id)
    expect(report.builds).toBe(4)
    expect(report.flaky).toMatchObject([
      {
        name: 'clock',
        changedIn: 3,
        reason: {
          kind: 'flip_flop',
          flipFlop: {
            count: 2,
            threshold: 2,
            window: 4,
            returns: [expect.anything(), expect.anything()],
          },
        },
      },
    ])
    // Each return names the build it was in and the earlier build whose image it came back to.
    const reason = report.flaky[0]?.reason
    if (reason?.kind !== 'flip_flop') throw new Error('expected a flip-flop reason')
    for (const r of reason.flipFlop.returns) expect(r.backTo).toBeLessThan(r.build)
  })

  it('does not report a redesign that changed the image every time (A, B, C, D, E)', async () => {
    const { project } = await project2()
    await seedFlipFlops(t.db, project.id, 'hero', ['A', 'B', 'C', 'D', 'E'])
    expect((await listFlakyScreenshots(t.db, project.id)).flaky).toEqual([])
  })

  it('does not recount one unapproved change in every later main build', async () => {
    const { project } = await project2()
    // The baseline never moved from A, so every build after the change shows `changed`, yet
    // the image is B every time: one change, no flip-flops.
    await seedMainRun(t.db, project.id, { images: { hero: 'A' } })
    for (let i = 0; i < 5; i += 1) {
      // oxlint-disable-next-line no-await-in-loop -- builds are numbered in order
      await seedMainRun(t.db, project.id, { images: { hero: 'B' }, changed: { hero: 0.3 } })
    }
    expect((await listFlakyScreenshots(t.db, project.id)).flaky).toEqual([])
  })

  it('treats reruns of one commit as one point, and different images across them as flaky', async () => {
    const { project } = await project2()
    await seedMainRun(t.db, project.id, {
      commit: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
      images: { hero: 'A' },
    })
    for (let i = 0; i < 4; i += 1) {
      // oxlint-disable-next-line no-await-in-loop -- builds are numbered in order
      await seedMainRun(t.db, project.id, {
        commit: 'b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3',
        images: { hero: 'B' },
        changed: { hero: 0.1 },
      })
    }
    expect((await listFlakyScreenshots(t.db, project.id)).flaky).toEqual([])
    // Same commit, a different image on one more run: the strongest signal, enough on its own.
    await seedMainRun(t.db, project.id, {
      commit: 'b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3',
      images: { hero: 'C' },
      changed: { hero: 0.2 },
    })
    const report = await listFlakyScreenshots(t.db, project.id)
    expect(report.builds).toBe(2)
    expect(report.flaky).toMatchObject([
      {
        name: 'hero',
        changedIn: 1,
        reason: { kind: 'reruns_disagree', reruns: { runs: 5, differing: 1, commits: 1 } },
      },
    ])
  })

  it('looks only at the default branch, and only at the last 10 commits', async () => {
    const { project } = await project2()
    await seedFlipFlops(t.db, project.id, 'old', ['A', 'B', 'A', 'B'])
    for (let i = 0; i < 10; i += 1) {
      // oxlint-disable-next-line no-await-in-loop -- builds are numbered in order
      await seedMainRun(t.db, project.id, { images: { quiet: 'Q' } })
    }
    expect((await listFlakyScreenshots(t.db, project.id)).flaky).toEqual([])

    const { project: other } = await project2()
    await seedMainRun(t.db, other.id, { images: { banner: 'A' }, branch: 'feature' })
    for (const image of ['B', 'A', 'B']) {
      // oxlint-disable-next-line no-await-in-loop -- builds are numbered in order
      await seedMainRun(t.db, other.id, {
        images: { banner: image },
        changed: { banner: 0.1 },
        branch: 'feature',
      })
    }
    expect((await listFlakyScreenshots(t.db, other.id)).flaky).toEqual([])
  })

  it('says nothing for a project with no builds', async () => {
    const { project } = await seedProject(t.db)
    expect(await listFlakyScreenshots(t.db, project.id)).toEqual({ builds: 0, flaky: [] })
  })
})

describe('loadFlakyHistory', () => {
  it('is bounded: never more builds per project than the cap, newest kept, oldest first', async () => {
    const { project } = await seedProject(t.db)
    for (let i = 0; i < FLAKY_HISTORY_MAX_BUILDS + 5; i += 1) {
      // oxlint-disable-next-line no-await-in-loop -- builds are numbered in order
      await seedMainRun(t.db, project.id, {
        images: { hero: i % 2 === 0 ? 'A' : 'B' },
        changed: { hero: 0.1 },
      })
    }
    const history = (await loadFlakyHistory(t.db, [project])).get(project.id) ?? []
    expect(history).toHaveLength(FLAKY_HISTORY_MAX_BUILDS)
    expect(history.map((b) => b.number)).toEqual(
      history.map((b) => b.number).toSorted((a, b) => a - b),
    )
    expect(history.at(-1)?.number).toBe(FLAKY_HISTORY_MAX_BUILDS + 5)
  })

  it('loads screenshots only for names that changed in the window', async () => {
    const { project } = await seedProject(t.db)
    await seedMainRun(t.db, project.id, { images: { moves: 'A', still: 'S' } })
    await seedMainRun(t.db, project.id, {
      images: { moves: 'B', still: 'S' },
      changed: { moves: 0.1 },
    })
    const [first, second] = (await loadFlakyHistory(t.db, [project])).get(project.id) ?? []
    expect([...(first?.shots.keys() ?? [])]).toEqual(['moves'])
    expect(second?.shots.get('moves')).toEqual({
      fileSha256: imageSha('B'),
      score: 0.1,
      sizeChanged: false,
      changed: true,
    })
  })

  it('loads only the projects it is asked for, and only their default branch', async () => {
    const { project } = await seedProject(t.db)
    const { project: hidden } = await seedProject(t.db)
    await seedMainRun(t.db, project.id, { images: { a: 'A' } })
    await seedMainRun(t.db, project.id, {
      images: { a: 'B' },
      changed: { a: 0.1 },
      branch: 'feature',
    })
    await seedMainRun(t.db, hidden.id, { images: { a: 'A' } })
    const history = await loadFlakyHistory(t.db, [project])
    expect([...history.keys()]).toEqual([project.id])
    expect(history.get(project.id)).toHaveLength(1)
  })

  it('stops before a build number, for the gate', async () => {
    const { project } = await seedProject(t.db)
    const runs = await seedFlipFlops(t.db, project.id, 'a', ['A', 'B', 'A', 'B'])
    const before = (await loadFlakyHistory(t.db, [project], { beforeNumber: runs[2]!.number })).get(
      project.id,
    )
    expect(before?.map((b) => b.number)).toEqual([runs[0]!.number, runs[1]!.number])
  })
})

describe('every consumer agrees', () => {
  it('the flaky list, Triage and the sidebar count name the same screenshots', async () => {
    const { project, workspace } = await project2()
    await seedFlipFlops(t.db, project.id, 'clock', ['A', 'B', 'A', 'B'])
    await seedFlipFlops(t.db, project.id, 'logo', ['X', 'Y', 'Z', 'W'])
    const list = (await listFlakyScreenshots(t.db, project.id)).flaky.map((f) => f.name)
    const triage = await listTriage(t.db, { projectId: project.id, now })
    const flakyItems = triage.items.filter((i) => i.kind === 'flaky')
    expect(flakyItems.map((i) => i.key)).toEqual(list)
    expect(flakyItems[0]?.reason).toMatchObject({ kind: 'flip_flop', flipFlop: { count: 2 } })
    expect(flakyItems[0]?.history.map((h) => h.changed)).toEqual([
      false,
      true,
      true,
      true,
      false,
      false,
      false,
      false,
    ])
    const counts = await countOpenTriage(t.db, { workspaceId: workspace.id, now })
    expect(counts.get(project.id)).toBe(triage.items.filter((i) => !i.snoozed).length)
    expect(list).toEqual(['clock'])
  })
})
