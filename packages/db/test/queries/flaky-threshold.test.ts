import { createTestDb, seedBuild, seedDiff, seedTeam } from '@circi/db/testing'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { countOpenTriage, listFlakyScreenshots } from '#src/queries/index.ts'
import { updateTeamSettings } from '#src/repositories/index.ts'
import * as schema from '#src/schema/index.ts'

let t: createTestDb.Result
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(async () => {
  await t.close()
})

/** `home` changes in two of three default-branch builds. */
async function twoChanges() {
  const { team, workspace } = await seedTeam(t.db)
  for (const status of ['changed', 'changed', 'unchanged'] as const) {
    // oxlint-disable-next-line no-await-in-loop -- tiny fixed list
    const build = await seedBuild(t.db, team.id, { branch: 'main', status: 'complete' })
    // oxlint-disable-next-line no-await-in-loop -- tiny fixed list
    await t.db
      .update(schema.builds)
      .set({ baselineSource: 'cli' })
      .where(eq(schema.builds.id, build.id))
    // oxlint-disable-next-line no-await-in-loop -- tiny fixed list
    await seedDiff(t.db, { buildId: build.id, name: 'home', status })
  }
  return { team, workspace }
}

describe("the team's flaky threshold", () => {
  it('is 3 changes by default, so two changes are not flaky', async () => {
    const { team } = await twoChanges()
    expect((await listFlakyScreenshots(t.db, team.id)).flaky).toEqual([])
  })

  it('makes a screenshot flaky at the number the team chose', async () => {
    const { team, workspace } = await twoChanges()
    await updateTeamSettings(t.db, team.id, { flakyAfterChanges: 2 })
    expect((await listFlakyScreenshots(t.db, team.id)).flaky).toEqual([
      { name: 'home', changedIn: 2 },
    ])
    // The sidebar's open-triage count agrees with the list.
    const counts = await countOpenTriage(t.db, { workspaceId: workspace.id, now: new Date() })
    expect(counts.get(team.id)).toBe(1)
    await updateTeamSettings(t.db, team.id, { flakyAfterChanges: 3 })
    expect((await listFlakyScreenshots(t.db, team.id)).flaky).toEqual([])
  })
})
