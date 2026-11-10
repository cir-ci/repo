import { buildOutcome } from '@circi/core'
import { listFlakyScreenshots } from '@circi/db/queries'
import {
  buildFlakyDecision,
  resetBuild,
  setBuildResult,
  setWorkspaceSettings,
  updateTeamSettings,
} from '@circi/db/repositories'
import {
  createTestDb,
  imageSha,
  seedBuild,
  seedDiff,
  seedFlipFlops,
  seedTeam,
} from '@circi/db/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { gateInputs } from '#src/index.ts'

let t: createTestDb.Result
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(async () => {
  await t.close()
})

interface Change {
  image?: string
  score?: number
  sizeChanged?: boolean
}

/**
 * A team whose `wobble` screenshot is flaky on main (A, B, A, B, A: three returns to an earlier
 * image, the biggest wobble 0.05), and a pull request build that changed `wobble` like `change`.
 */
async function flakyPr(over: { changed?: string[]; change?: Change } = {}) {
  const seeded = await seedTeam(t.db)
  const { team } = seeded
  await seedFlipFlops(t.db, team.id, 'wobble', ['A', 'B', 'A', 'B', 'A'], 0.05)
  const build = await seedBuild(t.db, team.id, {
    branch: 'feature',
    prNumber: 3,
    status: 'complete',
    conclusion: 'changes_detected',
  })
  const change = over.change ?? { image: 'B', score: 0.02 }
  for (const name of over.changed ?? ['wobble']) {
    // oxlint-disable-next-line no-await-in-loop -- a few rows
    await seedDiff(t.db, {
      buildId: build.id,
      name,
      status: 'changed',
      headSha256: imageSha(change.image ?? 'NEW'),
      score: change.score ?? 0.02,
      ...(change.sizeChanged ? { sizeChanged: true } : {}),
    })
  }
  return { ...seeded, build }
}

const outcomeOf = async (build: Awaited<ReturnType<typeof flakyPr>>['build']) =>
  buildOutcome({ ...build, ...(await gateInputs(t.db, build)) })

describe('gateInputs', () => {
  it("keeps today's default: a flaky-only change blocks like any other", async () => {
    const { build } = await flakyPr()
    expect(await gateInputs(t.db, build)).toEqual({
      blockMergeOnChanges: true,
      autoApproveNoChanges: true,
      flakyBlocksMerge: true,
      flakyOnly: true, // known variation, but flaky screenshots block by default
    })
    expect(await outcomeOf(build)).toMatchObject({ state: 'fail' })
  })

  it('passes a flaky-only change once the workspace stops blocking on flaky screenshots', async () => {
    const { build, workspace } = await flakyPr()
    await setWorkspaceSettings(t.db, workspace.id, { flakyBlocksMerge: false })
    expect(await gateInputs(t.db, build)).toMatchObject({
      flakyBlocksMerge: false,
      flakyOnly: true,
    })
    expect(await outcomeOf(build)).toEqual({
      state: 'pass',
      summary: 'Only flaky screenshots changed',
    })
  })

  it('passes a change to an image the screenshot already had on main, even a big one', async () => {
    const { build, workspace } = await flakyPr({
      change: { image: 'A', score: 0.9, sizeChanged: true },
    })
    await setWorkspaceSettings(t.db, workspace.id, { flakyBlocksMerge: false })
    expect(await outcomeOf(build)).toMatchObject({ state: 'pass' })
  })

  it("blocks a change that breaks a flaky screenshot's layout, whatever the setting", async () => {
    const { build, workspace } = await flakyPr({
      change: { image: 'NEW', score: 0.8, sizeChanged: true },
    })
    await setWorkspaceSettings(t.db, workspace.id, { flakyBlocksMerge: false })
    expect(await gateInputs(t.db, build)).toMatchObject({ flakyOnly: false })
    expect(await outcomeOf(build)).toMatchObject({
      state: 'fail',
      summary: 'Visual changes need review',
    })
  })

  it('blocks a bigger change of a flaky screenshot with the same size too', async () => {
    const { build, workspace } = await flakyPr({ change: { image: 'NEW', score: 0.3 } })
    await setWorkspaceSettings(t.db, workspace.id, { flakyBlocksMerge: false })
    expect(await outcomeOf(build)).toMatchObject({ state: 'fail' })
  })

  it('still blocks when the change is not only flaky', async () => {
    const { build, workspace } = await flakyPr({ changed: ['wobble', 'steady'] })
    await setWorkspaceSettings(t.db, workspace.id, { flakyBlocksMerge: false })
    expect(await gateInputs(t.db, build)).toMatchObject({ flakyOnly: false })
    expect(await outcomeOf(build)).toMatchObject({ state: 'fail' })
  })

  it('lets a team override the workspace either way', async () => {
    const { build, workspace, team } = await flakyPr()
    await setWorkspaceSettings(t.db, workspace.id, { flakyBlocksMerge: false })
    await updateTeamSettings(t.db, team.id, { flakyBlocksMerge: true })
    expect(await gateInputs(t.db, build)).toMatchObject({ flakyBlocksMerge: true })
    expect(await outcomeOf(build)).toMatchObject({ state: 'fail' })

    await setWorkspaceSettings(t.db, workspace.id, { flakyBlocksMerge: true })
    await updateTeamSettings(t.db, team.id, { flakyBlocksMerge: false })
    expect(await gateInputs(t.db, build)).toMatchObject({ flakyBlocksMerge: false })
    expect(await outcomeOf(build)).toMatchObject({ state: 'pass' })

    // Back to null: the workspace's value applies again.
    await updateTeamSettings(t.db, team.id, { flakyBlocksMerge: null })
    expect(await gateInputs(t.db, build)).toMatchObject({ flakyBlocksMerge: true })
  })

  it("doesn't count the build's own changes towards its flaky set", async () => {
    // Main flipped A, B, A, B: two returns, short of the team's 3. The gated build is on main
    // and returns to A, which would make three. It must be judged against the builds before it.
    const { team, workspace } = await seedTeam(t.db)
    await setWorkspaceSettings(t.db, workspace.id, { flakyBlocksMerge: false })
    await seedFlipFlops(t.db, team.id, 'wobble', ['A', 'B', 'A', 'B'], 0.05)
    const build = await seedBuild(t.db, team.id, {
      branch: 'main',
      status: 'complete',
      conclusion: 'changes_detected',
    })
    await seedDiff(t.db, {
      buildId: build.id,
      name: 'wobble',
      status: 'changed',
      headSha256: imageSha('A'),
      score: 0.05,
    })
    expect(await gateInputs(t.db, build)).toMatchObject({ flakyOnly: false })
  })
})

describe('the recorded decision', () => {
  it('is what the status endpoint and the check read, so a later main build cannot flip them', async () => {
    const { team, workspace } = await seedTeam(t.db)
    await setWorkspaceSettings(t.db, workspace.id, { flakyBlocksMerge: false })
    await seedFlipFlops(t.db, team.id, 'wobble', ['A', 'B', 'A', 'B', 'A'], 0.05)
    const pr = await seedBuild(t.db, team.id, {
      branch: 'feature',
      prNumber: 5,
      status: 'processing',
    })
    await seedDiff(t.db, {
      buildId: pr.id,
      name: 'wobble',
      status: 'changed',
      headSha256: imageSha('B'),
      score: 0.02,
    })
    // The pipeline records the decision when the build finishes (see `processBuild`).
    const decision = await buildFlakyDecision(t.db, pr)
    expect(decision.flakyOnly).toBe(true)
    const done = await setBuildResult(t.db, pr, {
      conclusion: 'changes_detected',
      approval: 'none',
      flakyDecision: decision,
    })
    expect(done.flakyDecision).toEqual(decision)
    expect(decision.flaky).toEqual([
      expect.objectContaining({ name: 'wobble', reason: 'came back to an earlier image 3 times' }),
    ])
    expect(await outcomeOf(done)).toEqual({
      state: 'pass',
      summary: 'Only flaky screenshots changed',
    })

    // Later main builds change the list: wobble stops flipping (a redesign), and the window moves on.
    for (const image of ['C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L']) {
      // oxlint-disable-next-line no-await-in-loop -- builds are numbered in order
      await seedFlipFlops(t.db, team.id, 'wobble', [image], 0.5)
    }
    expect((await listFlakyScreenshots(t.db, team.id)).flaky).toEqual([])
    // The pull request keeps the answer it was gated with.
    expect(await gateInputs(t.db, done)).toMatchObject({ flakyOnly: true })
    expect(await outcomeOf(done)).toMatchObject({ state: 'pass' })
    // What is stored is what is read: a stored "no" wins over anything recomputed.
    const stored = { ...done, flakyDecision: { flakyOnly: false, flaky: [] } }
    expect(await gateInputs(t.db, stored)).toMatchObject({ flakyOnly: false })

    // A rerun diffs the build again and decides again.
    const again = await resetBuild(t.db, done.id)
    expect(again.flakyDecision).toBeNull()
  })

  it('is not made for a build without changes', async () => {
    const { team } = await seedTeam(t.db)
    const pr = await seedBuild(t.db, team.id, {
      branch: 'feature',
      prNumber: 6,
      status: 'processing',
    })
    const done = await setBuildResult(t.db, pr, { conclusion: 'no_changes', approval: 'none' })
    expect(done.flakyDecision).toBeNull()
  })
})
