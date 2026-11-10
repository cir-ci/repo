import { createTestDb, seedFlipFlops, seedTeam } from '@circi/db/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { countOpenTriage, listFlakyScreenshots } from '#src/queries/index.ts'
import { updateTeamSettings } from '#src/repositories/index.ts'

let t: createTestDb.Result
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(async () => {
  await t.close()
})

/** `home` goes A, B, A, B: two returns to an earlier image. */
async function twoFlipFlops() {
  const { team, workspace } = await seedTeam(t.db)
  await seedFlipFlops(t.db, team.id, 'home', ['A', 'B', 'A', 'B'])
  return { team, workspace }
}

describe("the team's flaky threshold (flip-flops)", () => {
  it('is 3 by default, so two flip-flops are not flaky', async () => {
    const { team } = await twoFlipFlops()
    expect((await listFlakyScreenshots(t.db, team.id)).flaky).toEqual([])
  })

  it('makes a screenshot flaky at the number the team chose, in the list and the sidebar count alike', async () => {
    const { team, workspace } = await twoFlipFlops()
    await updateTeamSettings(t.db, team.id, { flakyAfterChanges: 2 })
    expect((await listFlakyScreenshots(t.db, team.id)).flaky).toMatchObject([
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
    expect(counts.get(team.id)).toBe(1)
    await updateTeamSettings(t.db, team.id, { flakyAfterChanges: 3 })
    expect((await listFlakyScreenshots(t.db, team.id)).flaky).toEqual([])
  })

  it('refuses a threshold of 1: one return is a revert, not flakiness', async () => {
    const { team } = await seedTeam(t.db)
    await expect(updateTeamSettings(t.db, team.id, { flakyAfterChanges: 1 })).rejects.toThrow(
      /flaky after 2 to 8 flip-flops/,
    )
  })
})
