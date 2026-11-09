import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { buildOutcome } from '@circi/core'
import { getBuild, getFile, listBuildReviews } from '@circi/db/queries'
import {
  addIgnoreRegion,
  createBuild,
  listBuildScreenshots,
  markFileVerified,
  planUploads,
  updateTeamSettings,
} from '@circi/db/repositories'
import { finalizeBuild, gateInputs, reviewBuild, reviewSnapshots } from '@circi/services'
import { contentKey, FsStorage } from '@circi/storage'
import { createTestDb, seedTeam, sha256 } from '@circi/testing'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { processBuild, startWorker } from '#src/index.ts'

let t: createTestDb.Result
let dir: string
let storage: FsStorage

beforeAll(async () => {
  t = await createTestDb()
  dir = await mkdtemp(join(tmpdir(), 'circi-worker-'))
  storage = new FsStorage({ path: dir })
})
afterAll(async () => {
  await t.close()
  await rm(dir, { recursive: true, force: true })
})

async function png(
  width: number,
  height: number,
  mark?: { x: number; y: number },
): Promise<Buffer> {
  const base = sharp({ create: { width, height, channels: 4, background: '#ffffff' } })
  if (!mark) return base.png().toBuffer()
  const dot = await sharp({ create: { width: 8, height: 8, channels: 4, background: '#e11d48' } })
    .png()
    .toBuffer()
  return sharp(await base.png().toBuffer())
    .composite([{ input: dot, left: mark.x, top: mark.y }])
    .png()
    .toBuffer()
}

/** Creates a build the way the API does: plan, store bytes, verify, finalize. */
async function uploadBuild(
  teamId: string,
  build: {
    commitSha: string
    branch: string
    name?: string
    prNumber?: number
    ancestorShas?: string[]
  },
  shots: Record<string, Buffer>,
) {
  const created = await createBuild(t.db, { teamId, ...build })
  const entries = Object.entries(shots)
  const planned = await planUploads(t.db, {
    buildId: created.id,
    kind: 'screenshot',
    files: entries.map(([, b]) => ({
      sha256: sha256(b),
      size: b.length,
      contentType: 'image/png',
    })),
    storageKeyFor: (s) => contentKey(s),
  })
  await Promise.all(
    planned.map(async (p) => {
      const bytes = entries.find(([, b]) => sha256(b) === p.sha256)?.[1]
      if (!bytes) throw new Error('planned file not in the build')
      await storage.put(p.storageKey, bytes, { expectedSha256: p.sha256 })
      await markFileVerified(t.db, p.sha256, { size: bytes.length })
    }),
  )
  const fin = await finalizeBuild(t.db, {
    buildId: created.id,
    screenshots: entries.map(([name, b]) => ({ name, sha256: sha256(b) })),
  })
  expect(fin).toMatchObject({ status: 'ok', complete: true })
  return created
}

async function diffsOf(buildId: string) {
  const rows = await t.db.query.screenshotDiffs.findMany({
    where: (d, { eq }) => eq(d.buildId, buildId),
  })
  return Object.fromEntries(rows.map((r) => [r.name, r]))
}

describe('processBuild', () => {
  it('runs a main → PR → main sequence end to end', async () => {
    const { team, owner } = await seedTeam(t.db)
    const home = await png(320, 200)
    const login = await png(320, 200, { x: 20, y: 20 })

    // 1. First build on main: no baseline, everything added. Never auto-approved: someone
    // approves every screenshot once.
    const b1 = await uploadBuild(team.id, { commitSha: 'aaaa001', branch: 'main' }, { home, login })
    expect(await processBuild({ db: t.db, storage }, b1.id)).toEqual({
      status: 'complete',
      conclusion: 'changes_detected',
      autoApproved: false,
    })
    expect(await getBuild(t.db, b1.id)).toMatchObject({
      status: 'complete',
      reviewStatus: 'pending',
      baseBuildId: null,
      baselineSource: 'none',
    })
    const d1 = await diffsOf(b1.id)
    expect([d1.home?.status, d1.login?.status]).toEqual(['added', 'added'])
    await reviewBuild(t.db, { buildId: b1.id, userId: owner.id, state: 'approved' })

    // 2. PR forked from main@aaaa001: one change, one new screenshot.
    const loginChanged = await png(320, 200, { x: 200, y: 120 })
    const signup = await png(320, 240)
    const b2 = await uploadBuild(
      team.id,
      { commitSha: 'bbbb001', branch: 'feature', prNumber: 7, ancestorShas: ['aaaa001'] },
      { home, login: loginChanged, signup },
    )
    expect(await processBuild({ db: t.db, storage }, b2.id)).toMatchObject({
      conclusion: 'changes_detected',
      autoApproved: false,
    })
    expect(await getBuild(t.db, b2.id)).toMatchObject({
      baseBuildId: b1.id,
      baselineSource: 'cli',
      reviewStatus: 'pending',
    })
    const d2 = await diffsOf(b2.id)
    expect(d2.home).toMatchObject({ status: 'unchanged', score: 0 })
    expect(d2.signup).toMatchObject({ status: 'added' })
    expect(d2.login).toMatchObject({ status: 'changed', sizeChanged: false, changedPixels: 128 })
    const diffFile = await getFile(t.db, d2.login?.diffFileSha256 ?? '')
    expect(diffFile).toMatchObject({ kind: 'diff', status: 'verified', width: 320, height: 200 })

    // Thumbnails and dimensions were recorded.
    const shots = await listBuildScreenshots(t.db, b2.id)
    expect(shots.every((s) => s.thumbnailSha256)).toBe(true)
    expect(await getFile(t.db, sha256(signup))).toMatchObject({ width: 320, height: 240 })

    // 3. Main again, same screenshots as build 1: no changes, not auto-approved (nothing to approve).
    const b3 = await uploadBuild(
      team.id,
      { commitSha: 'aaaa002', branch: 'main', ancestorShas: ['aaaa001'] },
      { home, login },
    )
    expect(await processBuild({ db: t.db, storage }, b3.id)).toMatchObject({
      conclusion: 'no_changes',
      autoApproved: false,
    })
  })

  it('holds the first build of a team with no baseline for review, and blocks the gate', async () => {
    // No neutral state: with nothing to compare against, every screenshot is "added", which is a
    // change a person must look at.
    const { team } = await seedTeam(t.db)
    const home = await png(320, 200)
    const first = await uploadBuild(
      team.id,
      { commitSha: 'fff0001', branch: 'feature', prNumber: 1 },
      { home },
    )
    expect(await processBuild({ db: t.db, storage }, first.id)).toEqual({
      status: 'complete',
      conclusion: 'changes_detected',
      autoApproved: false,
    })
    const build = await getBuild(t.db, first.id)
    expect(build).toMatchObject({ reviewStatus: 'pending', baseBuildId: null })
    expect((await diffsOf(first.id)).home?.status).toBe('added')
    expect(buildOutcome({ ...build!, ...(await gateInputs(t.db, build!)) })).toMatchObject({
      state: 'fail',
      summary: 'Visual changes need review',
    })
  })

  it('holds the first default-branch build for review even with auto-approval on', async () => {
    const { team } = await seedTeam(t.db)
    expect(team.autoApproveDefaultBranch).toBe(true)
    const first = await uploadBuild(
      team.id,
      { commitSha: 'fff0002', branch: 'main' },
      { home: await png(320, 200) },
    )
    expect(await processBuild({ db: t.db, storage }, first.id)).toEqual({
      status: 'complete',
      conclusion: 'changes_detected',
      autoApproved: false,
    })
    const build = await getBuild(t.db, first.id)
    expect(build).toMatchObject({ reviewStatus: 'pending', baseBuildId: null })
    expect(await listBuildReviews(t.db, first.id)).toEqual([])
    expect(buildOutcome({ ...build!, ...(await gateInputs(t.db, build!)) })).toMatchObject({
      state: 'fail',
    })
  })

  it('has no baseline after a pending first build until someone approves it', async () => {
    const { team, owner } = await seedTeam(t.db)
    const home = await png(320, 200)
    const first = await uploadBuild(team.id, { commitSha: 'fff0003', branch: 'main' }, { home })
    await processBuild({ db: t.db, storage }, first.id)

    // Still unapproved: the next build finds no baseline and is held as well.
    const second = await uploadBuild(
      team.id,
      { commitSha: 'fff0004', branch: 'main', ancestorShas: ['fff0003'] },
      { home },
    )
    expect(await processBuild({ db: t.db, storage }, second.id)).toMatchObject({
      conclusion: 'changes_detected',
      autoApproved: false,
    })
    expect(await getBuild(t.db, second.id)).toMatchObject({
      baseBuildId: null,
      reviewStatus: 'pending',
    })

    await reviewBuild(t.db, { buildId: first.id, userId: owner.id, state: 'approved' })
    const third = await uploadBuild(
      team.id,
      { commitSha: 'fff0005', branch: 'main', ancestorShas: ['fff0003'] },
      { home },
    )
    expect(await processBuild({ db: t.db, storage }, third.id)).toMatchObject({
      conclusion: 'no_changes',
    })
    expect(await getBuild(t.db, third.id)).toMatchObject({ baseBuildId: first.id })
  })

  it('auto-approves a default-branch build once an approved baseline exists', async () => {
    const { team, owner } = await seedTeam(t.db)
    const first = await uploadBuild(
      team.id,
      { commitSha: 'fff0006', branch: 'main' },
      { home: await png(320, 200) },
    )
    await processBuild({ db: t.db, storage }, first.id)
    await reviewBuild(t.db, { buildId: first.id, userId: owner.id, state: 'approved' })

    const second = await uploadBuild(
      team.id,
      { commitSha: 'fff0007', branch: 'main', ancestorShas: ['fff0006'] },
      { home: await png(320, 200, { x: 30, y: 30 }) },
    )
    expect(await processBuild({ db: t.db, storage }, second.id)).toEqual({
      status: 'complete',
      conclusion: 'changes_detected',
      autoApproved: true,
    })
    expect(await getBuild(t.db, second.id)).toMatchObject({
      baseBuildId: first.id,
      reviewStatus: 'approved',
    })
    expect(await listBuildReviews(t.db, second.id)).toMatchObject([
      { state: 'approved', source: 'auto' },
    ])
  })

  it('compares a snapshot with its approved version in a default-branch build still waiting on review', async () => {
    const { team, owner } = await seedTeam(t.db)
    await updateTeamSettings(t.db, team.id, { autoApproveDefaultBranch: false })
    const plain = await png(320, 200)
    const marked = await png(320, 200, { x: 30, y: 30 })
    const other = await png(320, 200, { x: 90, y: 90 })
    const first = await uploadBuild(
      team.id,
      { commitSha: 'fff0b01', branch: 'main' },
      { home: plain, about: plain },
    )
    await processBuild({ db: t.db, storage }, first.id)
    await reviewBuild(t.db, { buildId: first.id, userId: owner.id, state: 'approved' })

    const second = await uploadBuild(
      team.id,
      { commitSha: 'fff0b02', branch: 'main', ancestorShas: ['fff0b01'] },
      { home: marked, about: other },
    )
    await processBuild({ db: t.db, storage }, second.id)
    await reviewSnapshots(t.db, {
      buildId: second.id,
      userId: owner.id,
      decision: 'approved',
      snapshotNames: ['home'],
    })
    expect(await getBuild(t.db, second.id)).toMatchObject({ reviewStatus: 'pending' })

    const third = await uploadBuild(
      team.id,
      { commitSha: 'fff0b03', branch: 'main', ancestorShas: ['fff0b02', 'fff0b01'] },
      { home: marked, about: other },
    )
    await processBuild({ db: t.db, storage }, third.id)
    expect(await getBuild(t.db, third.id)).toMatchObject({ baseBuildId: first.id })
    const diffs = await diffsOf(third.id)
    // home was approved on its own in the pending second build; about still compares with the first.
    expect(diffs['home']?.status).toBe('unchanged')
    expect(diffs['about']?.status).toBe('changed')
  })

  it('holds a default-branch build with a baseline when auto-approval is off', async () => {
    const { team, owner } = await seedTeam(t.db)
    await updateTeamSettings(t.db, team.id, { autoApproveDefaultBranch: false })
    const first = await uploadBuild(
      team.id,
      { commitSha: 'fff0008', branch: 'main' },
      { home: await png(320, 200) },
    )
    expect(await processBuild({ db: t.db, storage }, first.id)).toMatchObject({
      autoApproved: false,
    })
    await reviewBuild(t.db, { buildId: first.id, userId: owner.id, state: 'approved' })
    const second = await uploadBuild(
      team.id,
      { commitSha: 'fff0009', branch: 'main', ancestorShas: ['fff0008'] },
      { home: await png(320, 200, { x: 30, y: 30 }) },
    )
    expect(await processBuild({ db: t.db, storage }, second.id)).toMatchObject({
      conclusion: 'changes_detected',
      autoApproved: false,
    })
    expect(await getBuild(t.db, second.id)).toMatchObject({ reviewStatus: 'pending' })
  })

  it('reports a removed screenshot and a 1px size change as changes', async () => {
    const { team, owner } = await seedTeam(t.db)
    const b1 = await uploadBuild(
      team.id,
      { commitSha: 'cccc001', branch: 'main' },
      { a: await png(100, 400), gone: await png(100, 100) },
    )
    await processBuild({ db: t.db, storage }, b1.id)
    await reviewBuild(t.db, { buildId: b1.id, userId: owner.id, state: 'approved' })
    const b2 = await uploadBuild(
      team.id,
      { commitSha: 'cccc002', branch: 'main', ancestorShas: ['cccc001'] },
      { a: await png(100, 401) },
    )
    await processBuild({ db: t.db, storage }, b2.id)
    const d = await diffsOf(b2.id)
    expect(d.gone).toMatchObject({ status: 'removed', headScreenshotId: null })
    expect(d.a).toMatchObject({ status: 'changed', sizeChanged: true })
  })

  it('marks screenshots that are not PNGs as failed instead of crashing', async () => {
    const { team } = await seedTeam(t.db)
    const notPng = Buffer.from('definitely not a png')
    const b = await uploadBuild(
      team.id,
      { commitSha: 'dddd001', branch: 'main' },
      { broken: notPng },
    )
    expect(await processBuild({ db: t.db, storage }, b.id)).toMatchObject({
      conclusion: 'changes_detected',
    })
    const d = await diffsOf(b.id)
    expect(d.broken).toMatchObject({
      status: 'failed',
      errorMessage: expect.stringMatching(/Not a readable image/),
    })
  })

  it('skips builds that are not waiting to be processed', async () => {
    const { team } = await seedTeam(t.db)
    const b = await uploadBuild(
      team.id,
      { commitSha: 'eeee001', branch: 'main' },
      { x: await png(10, 10) },
    )
    await processBuild({ db: t.db, storage }, b.id)
    expect(await processBuild({ db: t.db, storage }, b.id)).toEqual({
      status: 'skipped',
      reason: 'build is complete',
    })
  })
})

function pr(extra: { name?: string } = {}) {
  return {
    commitSha: 'bbbb001',
    branch: 'feature',
    prNumber: 4,
    ancestorShas: ['aaaa001'],
    ...extra,
  }
}

/** A team on main with a baseline, and a PR whose screenshot changed. */
async function prSetup() {
  const { team, owner } = await seedTeam(t.db)
  const home = await png(200, 100)
  const base = await uploadBuild(team.id, { commitSha: 'aaaa001', branch: 'main' }, { home })
  await processBuild({ db: t.db, storage }, base.id)
  const changed = await png(200, 100, { x: 50, y: 50 })
  return { team, owner, home, changed }
}

describe('ignored regions', () => {
  it('leaves a changing clock out of the comparison, but not the rest of the page', async () => {
    const { team, owner } = await seedTeam(t.db)
    const before = await png(320, 200, { x: 20, y: 20 })
    const clockMoved = await png(320, 200, { x: 24, y: 24 }) // the "clock" differs
    const base = await uploadBuild(
      team.id,
      { commitSha: 'bbbb001', branch: 'main' },
      { home: before },
    )
    await processBuild({ db: t.db, storage }, base.id)
    await reviewBuild(t.db, { buildId: base.id, userId: owner.id, state: 'approved' })

    // Without a rule, the changed clock is a change.
    const plain = await uploadBuild(
      team.id,
      { commitSha: 'bbbb002', branch: 'main', ancestorShas: ['bbbb001'] },
      { home: clockMoved },
    )
    await processBuild({ db: t.db, storage }, plain.id)
    expect((await diffsOf(plain.id)).home?.status).toBe('changed')

    // With a rule covering the clock, the same difference no longer counts.
    await addIgnoreRegion(t.db, team.id, { name: 'home', x: 10, y: 10, width: 40, height: 40 })
    const masked = await uploadBuild(
      team.id,
      { commitSha: 'bbbb003', branch: 'main', ancestorShas: ['bbbb001'] },
      { home: clockMoved },
    )
    expect((await processBuild({ db: t.db, storage }, masked.id)).status).toBe('complete')
    expect((await diffsOf(masked.id)).home?.status).toBe('unchanged')

    // A rule for another screenshot name changes nothing here.
    await addIgnoreRegion(t.db, team.id, { name: 'login', x: 0, y: 0, width: 320, height: 200 })
    const stillMasked = await uploadBuild(
      team.id,
      { commitSha: 'bbbb004', branch: 'main', ancestorShas: ['bbbb001'] },
      { home: await png(320, 200, { x: 200, y: 150 }) },
    )
    await processBuild({ db: t.db, storage }, stillMasked.id)
    expect((await diffsOf(stillMasked.id)).home?.status).toBe('changed')
  })
})

describe('re-runs of an approved commit', () => {
  it('approves a re-run with the same screenshots, and says why', async () => {
    const { team, owner, changed } = await prSetup()
    const first = await uploadBuild(team.id, pr(), { home: changed })
    expect(await processBuild({ db: t.db, storage }, first.id)).toMatchObject({
      conclusion: 'changes_detected',
      autoApproved: false,
    })
    // Nothing is approved yet, so an identical re-run still needs a decision.
    const early = await uploadBuild(team.id, pr(), { home: changed })
    expect(await processBuild({ db: t.db, storage }, early.id)).toMatchObject({
      autoApproved: false,
    })

    await reviewBuild(t.db, { buildId: first.id, userId: owner.id, state: 'approved' })
    const rerun = await uploadBuild(team.id, pr(), { home: changed })
    expect(await processBuild({ db: t.db, storage }, rerun.id)).toMatchObject({
      conclusion: 'changes_detected',
      autoApproved: true,
    })
    expect((await getBuild(t.db, rerun.id))?.reviewStatus).toBe('approved')
    expect(await listBuildReviews(t.db, rerun.id)).toMatchObject([
      { state: 'approved', source: 'rerun', userName: null },
    ])
  })

  it('does not approve a re-run that differs in any screenshot', async () => {
    const { team, owner, changed, home } = await prSetup()
    const first = await uploadBuild(team.id, pr(), { home: changed })
    await processBuild({ db: t.db, storage }, first.id)
    await reviewBuild(t.db, { buildId: first.id, userId: owner.id, state: 'approved' })

    const different = await png(200, 100, { x: 120, y: 10 })
    const another = await uploadBuild(team.id, pr(), { home: different })
    expect(await processBuild({ db: t.db, storage }, another.id)).toMatchObject({
      autoApproved: false,
    })
    const extra = await uploadBuild(team.id, pr(), { home: changed, about: home })
    expect(await processBuild({ db: t.db, storage }, extra.id)).toMatchObject({
      autoApproved: false,
    })
  })

  it('does not carry approval to another commit, another build name, or past a rejection', async () => {
    const { team, owner, changed } = await prSetup()
    const first = await uploadBuild(team.id, pr(), { home: changed })
    await processBuild({ db: t.db, storage }, first.id)
    await reviewBuild(t.db, { buildId: first.id, userId: owner.id, state: 'approved' })

    const otherCommit = await uploadBuild(
      team.id,
      { ...pr(), commitSha: 'cccc001' },
      { home: changed },
    )
    expect(await processBuild({ db: t.db, storage }, otherCommit.id)).toMatchObject({
      autoApproved: false,
    })
    const otherName = await uploadBuild(team.id, pr({ name: 'mobile' }), { home: changed })
    expect(await processBuild({ db: t.db, storage }, otherName.id)).toMatchObject({
      autoApproved: false,
    })

    await reviewBuild(t.db, { buildId: first.id, userId: owner.id, state: 'rejected' })
    const afterRejection = await uploadBuild(team.id, pr(), { home: changed })
    expect(await processBuild({ db: t.db, storage }, afterRejection.id)).toMatchObject({
      autoApproved: false,
    })
  })
})

describe('startWorker', () => {
  it('picks up the job finalize enqueued and completes the build', async () => {
    const { team } = await seedTeam(t.db)
    const b = await uploadBuild(
      team.id,
      { commitSha: 'ffff001', branch: 'main' },
      { x: await png(10, 10) },
    )
    const silent = { info() {}, warn() {}, error() {} }
    const worker = await startWorker({ db: t.db, storage, logger: silent, pollIntervalMs: 20 })
    try {
      await expect
        .poll(async () => (await getBuild(t.db, b.id))?.status, { timeout: 5_000, interval: 25 })
        .toBe('complete')
    } finally {
      await worker.stop()
    }
  })
})
