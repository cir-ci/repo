import { buildOutcome } from '@circi/core'
import { setOrgSettings, updateProjectSettings } from '@circi/db'
import { createTestDb, seedBuild, seedDiff, seedProject, type TestDb } from '@circi/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { gateInputs } from '../src/index.ts'

let t: TestDb
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(async () => {
  await t.close()
})

let n = 0
/** A project whose `wobble` screenshot is flaky, and a pull request build that changed only it. */
async function flakyPr(over: { changed?: string[] } = {}) {
  const seeded = await seedProject(t.db)
  const { project } = seeded
  for (let i = 0; i < 3; i += 1) {
    n += 1
    // oxlint-disable-next-line no-await-in-loop -- builds are numbered in order
    const main = await seedBuild(t.db, project.id, { branch: 'main', status: 'complete' })
    // oxlint-disable-next-line no-await-in-loop
    await seedDiff(t.db, { buildId: main.id, name: 'wobble', status: 'changed' })
  }
  const build = await seedBuild(t.db, project.id, {
    branch: 'feature',
    prNumber: 3,
    status: 'complete',
    conclusion: 'changes_detected',
  })
  for (const name of over.changed ?? ['wobble']) {
    // oxlint-disable-next-line no-await-in-loop -- a few rows
    await seedDiff(t.db, { buildId: build.id, name, status: 'changed' })
  }
  return { ...seeded, build }
}

const outcomeOf = async (build: Awaited<ReturnType<typeof flakyPr>>['build']) =>
  buildOutcome({ ...build, ...(await gateInputs(t.db, build)) })

describe('gateInputs', () => {
  it('keeps today’s behaviour by default: a flaky-only change blocks like any other', async () => {
    const { build } = await flakyPr()
    expect(await gateInputs(t.db, build)).toEqual({
      blockMergeOnChanges: true,
      flakyBlocksMerge: true,
      flakyOnly: false, // not looked up while it cannot matter
    })
    expect(await outcomeOf(build)).toMatchObject({ state: 'fail' })
  })

  it('passes a flaky-only change once the organization stops blocking on flaky screenshots', async () => {
    const { build, org } = await flakyPr()
    await setOrgSettings(t.db, org.id, { flakyBlocksMerge: false })
    expect(await gateInputs(t.db, build)).toMatchObject({
      flakyBlocksMerge: false,
      flakyOnly: true,
    })
    expect(await outcomeOf(build)).toEqual({
      state: 'pass',
      summary: 'Only flaky screenshots changed',
    })
  })

  it('still blocks when the change is not only flaky', async () => {
    const { build, org } = await flakyPr({ changed: ['wobble', 'steady'] })
    await setOrgSettings(t.db, org.id, { flakyBlocksMerge: false })
    expect(await gateInputs(t.db, build)).toMatchObject({ flakyOnly: false })
    expect(await outcomeOf(build)).toMatchObject({ state: 'fail' })
  })

  it('lets a project override the organization either way', async () => {
    const { build, org, project } = await flakyPr()
    await setOrgSettings(t.db, org.id, { flakyBlocksMerge: false })
    await updateProjectSettings(t.db, project.id, { flakyBlocksMerge: true })
    expect(await gateInputs(t.db, build)).toMatchObject({ flakyBlocksMerge: true })
    expect(await outcomeOf(build)).toMatchObject({ state: 'fail' })

    await setOrgSettings(t.db, org.id, { flakyBlocksMerge: true })
    await updateProjectSettings(t.db, project.id, { flakyBlocksMerge: false })
    expect(await gateInputs(t.db, build)).toMatchObject({ flakyBlocksMerge: false })
    expect(await outcomeOf(build)).toMatchObject({ state: 'pass' })

    // Back to null: the organization's value applies again.
    await updateProjectSettings(t.db, project.id, { flakyBlocksMerge: null })
    expect(await gateInputs(t.db, build)).toMatchObject({ flakyBlocksMerge: true })
  })
})
