import { createHash } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  createBuild,
  finalizeBuild,
  getBuild,
  getFile,
  listBuildScreenshots,
  markFileVerified,
  planUploads,
} from '@circi/db'
import { contentKey, FsStorage } from '@circi/storage'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createTestDb, seedProject, type TestDb } from '../../../packages/db/test/helpers.ts'
import { processBuild, startWorker } from '../src/index.ts'

let t: TestDb
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

const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex')

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
  projectId: string,
  build: { commitSha: string; branch: string; prNumber?: number; ancestorShas?: string[] },
  shots: Record<string, Buffer>,
) {
  const created = await createBuild(t.db, { projectId, ...build })
  const entries = Object.entries(shots)
  const planned = await planUploads(t.db, {
    buildId: created.id,
    kind: 'screenshot',
    files: entries.map(([, b]) => ({ sha256: sha(b), size: b.length, contentType: 'image/png' })),
    storageKeyFor: (s) => contentKey(s),
  })
  await Promise.all(
    planned.map(async (p) => {
      const bytes = entries.find(([, b]) => sha(b) === p.sha256)?.[1]
      if (!bytes) throw new Error('planned file not in the build')
      await storage.put(p.storageKey, bytes, { expectedSha256: p.sha256 })
      await markFileVerified(t.db, p.sha256, { size: bytes.length })
    }),
  )
  const fin = await finalizeBuild(t.db, {
    buildId: created.id,
    screenshots: entries.map(([name, b]) => ({ name, sha256: sha(b) })),
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
    const { project } = await seedProject(t.db)
    const home = await png(320, 200)
    const login = await png(320, 200, { x: 20, y: 20 })

    // 1. First build on main: no baseline, everything added, auto-approved.
    const b1 = await uploadBuild(
      project.id,
      { commitSha: 'aaaa001', branch: 'main' },
      { home, login },
    )
    expect(await processBuild({ db: t.db, storage }, b1.id)).toEqual({
      status: 'complete',
      conclusion: 'changes_detected',
      autoApproved: true,
    })
    expect(await getBuild(t.db, b1.id)).toMatchObject({
      status: 'complete',
      reviewStatus: 'approved',
      baseBuildId: null,
      baselineSource: 'none',
    })
    const d1 = await diffsOf(b1.id)
    expect([d1.home?.status, d1.login?.status]).toEqual(['added', 'added'])

    // 2. PR forked from main@aaaa001: one change, one new screenshot.
    const loginChanged = await png(320, 200, { x: 200, y: 120 })
    const signup = await png(320, 240)
    const b2 = await uploadBuild(
      project.id,
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
    expect(await getFile(t.db, sha(signup))).toMatchObject({ width: 320, height: 240 })

    // 3. Main again, same screenshots as build 1: no changes, not auto-approved (nothing to approve).
    const b3 = await uploadBuild(
      project.id,
      { commitSha: 'aaaa002', branch: 'main', ancestorShas: ['aaaa001'] },
      { home, login },
    )
    expect(await processBuild({ db: t.db, storage }, b3.id)).toMatchObject({
      conclusion: 'no_changes',
      autoApproved: false,
    })
  })

  it('reports a removed screenshot and a 1px size change as changes', async () => {
    const { project } = await seedProject(t.db)
    const b1 = await uploadBuild(
      project.id,
      { commitSha: 'cccc001', branch: 'main' },
      { a: await png(100, 400), gone: await png(100, 100) },
    )
    await processBuild({ db: t.db, storage }, b1.id)
    const b2 = await uploadBuild(
      project.id,
      { commitSha: 'cccc002', branch: 'main', ancestorShas: ['cccc001'] },
      { a: await png(100, 401) },
    )
    await processBuild({ db: t.db, storage }, b2.id)
    const d = await diffsOf(b2.id)
    expect(d.gone).toMatchObject({ status: 'removed', headScreenshotId: null })
    expect(d.a).toMatchObject({ status: 'changed', sizeChanged: true })
  })

  it('marks screenshots that are not PNGs as failed instead of crashing', async () => {
    const { project } = await seedProject(t.db)
    const notPng = Buffer.from('definitely not a png')
    const b = await uploadBuild(
      project.id,
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
    const { project } = await seedProject(t.db)
    const b = await uploadBuild(
      project.id,
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

describe('startWorker', () => {
  it('picks up the job finalize enqueued and completes the build', async () => {
    const { project } = await seedProject(t.db)
    const b = await uploadBuild(
      project.id,
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
