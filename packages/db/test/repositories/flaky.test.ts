import { createTestDb, seedBuild, seedDiff, seedProject, type TestDb } from '@circi/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { listFlakyScreenshots } from '../../src/index.ts'

let t: TestDb
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(async () => {
  await t.close()
})

let n = 0
/** A finished default-branch build whose screenshots had these statuses. */
async function mainBuild(
  projectId: string,
  statuses: Record<string, 'changed' | 'unchanged'>,
  branch = 'main',
) {
  n += 1
  const build = await seedBuild(t.db, projectId, {
    commitSha: `abc${String(n).padStart(4, '0')}0`,
    branch,
    status: 'complete',
  })
  for (const [name, status] of Object.entries(statuses)) {
    // oxlint-disable-next-line no-await-in-loop -- a few rows, in order
    await seedDiff(t.db, { buildId: build.id, name, status })
  }
}

describe('listFlakyScreenshots', () => {
  it('reports screenshots that changed in several recent default-branch builds, worst first', async () => {
    const { project } = await seedProject(t.db)
    for (let i = 0; i < 5; i += 1) {
      // eslint-disable-next-line no-await-in-loop -- builds are numbered in order
      await mainBuild(project.id, {
        clock: 'changed',
        avatar: i % 2 === 0 ? 'changed' : 'unchanged',
        header: i === 4 ? 'changed' : 'unchanged',
        footer: 'unchanged',
      })
    }
    const report = await listFlakyScreenshots(t.db, project.id)
    expect(report.builds).toBe(5)
    expect(report.flaky).toEqual([
      { name: 'clock', changedIn: 5 },
      { name: 'avatar', changedIn: 3 },
    ])
  })

  it('looks only at the default branch, and only at the recent builds', async () => {
    const { project } = await seedProject(t.db)
    for (let i = 0; i < 4; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await mainBuild(project.id, { banner: 'changed' }, 'feature') // other branches don't count
    }
    expect((await listFlakyScreenshots(t.db, project.id)).flaky).toEqual([])

    for (let i = 0; i < 4; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await mainBuild(project.id, { old: 'changed' })
    }
    for (let i = 0; i < 3; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await mainBuild(project.id, { old: 'unchanged' })
    }
    expect((await listFlakyScreenshots(t.db, project.id, { window: 3 })).flaky).toEqual([])
    expect((await listFlakyScreenshots(t.db, project.id, { window: 10 })).flaky).toEqual([
      { name: 'old', changedIn: 4 },
    ])
  })

  it('says nothing for a project with no builds, or one that never flickers', async () => {
    const { project } = await seedProject(t.db)
    expect(await listFlakyScreenshots(t.db, project.id)).toEqual({ builds: 0, flaky: [] })
    await mainBuild(project.id, { a: 'unchanged' })
    expect((await listFlakyScreenshots(t.db, project.id)).flaky).toEqual([])
  })
})
