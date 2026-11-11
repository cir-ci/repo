import { createTestDb, seedFlipFlops, seedProject } from '@circi/db/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { countOpenTriage, listFlakyScreenshots } from '#src/queries/index.ts'
import { updateProjectSettings } from '#src/repositories/index.ts'

let t: createTestDb.Result
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(async () => {
  await t.close()
})

/** `home` goes A, B, A, B: two returns to an earlier image. */
async function twoFlipFlops() {
  const { project, workspace } = await seedProject(t.db)
  await seedFlipFlops(t.db, project.id, 'home', ['A', 'B', 'A', 'B'])
  return { project, workspace }
}

describe("the project's flaky threshold (flip-flops)", () => {
  it('is 3 by default, so two flip-flops are not flaky', async () => {
    const { project } = await twoFlipFlops()
    expect((await listFlakyScreenshots(t.db, project.id)).flaky).toEqual([])
  })

  it('makes a screenshot flaky at the number the project chose, in the list and the sidebar count alike', async () => {
    const { project, workspace } = await twoFlipFlops()
    await updateProjectSettings(t.db, project.id, { flakyAfterChanges: 2 })
    expect((await listFlakyScreenshots(t.db, project.id)).flaky).toMatchObject([
      {
        name: 'home',
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
    const counts = await countOpenTriage(t.db, { workspaceId: workspace.id, now: new Date() })
    expect(counts.get(project.id)).toBe(1)
    await updateProjectSettings(t.db, project.id, { flakyAfterChanges: 3 })
    expect((await listFlakyScreenshots(t.db, project.id)).flaky).toEqual([])
  })

  it('refuses a threshold of 1: one return is a revert, not flakiness', async () => {
    const { project } = await seedProject(t.db)
    await expect(updateProjectSettings(t.db, project.id, { flakyAfterChanges: 1 })).rejects.toThrow(
      /flaky after 2 to 8 flip-flops/,
    )
  })
})
