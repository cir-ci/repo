import { createTestDb, seedBuild, seedDiff, seedProject, type TestDb } from '@circi/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { buildChangesAreFlakyOnly, listFlakyScreenshots } from '#src/index.ts'

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

/** A project whose `wobble` is flaky (changed in 3 main builds) and `steady` is not. */
async function flakyProject() {
  const { project } = await seedProject(t.db)
  for (let i = 0; i < 3; i += 1) {
    // oxlint-disable-next-line no-await-in-loop -- builds are numbered in order
    await mainBuild(project.id, { wobble: 'changed', steady: 'unchanged' })
  }
  return project
}

async function pr(
  projectId: string,
  diffs: Record<string, 'added' | 'removed' | 'changed' | 'unchanged' | 'failed'>,
) {
  n += 1
  const build = await seedBuild(t.db, projectId, {
    commitSha: `abc${String(n).padStart(4, '0')}1`,
    branch: 'feature',
    prNumber: 1,
    status: 'complete',
  })
  for (const [name, status] of Object.entries(diffs)) {
    // oxlint-disable-next-line no-await-in-loop -- a few rows
    await seedDiff(t.db, { buildId: build.id, name, status })
  }
  return build
}

describe('buildChangesAreFlakyOnly', () => {
  it('is true when the only changes are flaky screenshots', async () => {
    const project = await flakyProject()
    const build = await pr(project.id, { wobble: 'changed', steady: 'unchanged' })
    expect(await buildChangesAreFlakyOnly(t.db, build)).toBe(true)
  })

  it('is false when a steady screenshot changed too', async () => {
    const project = await flakyProject()
    const build = await pr(project.id, { wobble: 'changed', steady: 'changed' })
    expect(await buildChangesAreFlakyOnly(t.db, build)).toBe(false)
  })

  it.each(['added', 'removed', 'failed'] as const)(
    'is false when a screenshot is %s, even next to a flaky change',
    async (status) => {
      const project = await flakyProject()
      const build = await pr(project.id, { wobble: 'changed', extra: status })
      expect(await buildChangesAreFlakyOnly(t.db, build)).toBe(false)
    },
  )

  it('is false without any change, and when nothing is flaky yet', async () => {
    const project = await flakyProject()
    expect(
      await buildChangesAreFlakyOnly(t.db, await pr(project.id, { wobble: 'unchanged' })),
    ).toBe(false)
    const { project: fresh } = await seedProject(t.db)
    expect(await buildChangesAreFlakyOnly(t.db, await pr(fresh.id, { wobble: 'changed' }))).toBe(
      false,
    )
  })
})
