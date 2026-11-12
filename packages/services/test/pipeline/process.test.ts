import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { getBuild, getFile } from '@circi/db/queries'
import {
  createBuild,
  listBuildDiffs,
  listBuildScreenshots,
  markFileVerified,
  planUploads,
} from '@circi/db/repositories'
import { files } from '@circi/db/schema'
import { createTestDb, seedProject } from '@circi/db/testing'
import type { diffImages, makeThumbnail, readPngInfo } from '@circi/diff'
import { contentKey, FsStorage } from '@circi/storage'
import { sha256 } from '@circi/testing'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { createLoader, finalizeBuild, processBuild, reviewBuild } from '#src/index.ts'

let t: createTestDb.Result
let dir: string
let storage: FsStorage

beforeAll(async () => {
  t = await createTestDb()
  dir = await mkdtemp(join(tmpdir(), 'circi-pipeline-'))
  storage = new FsStorage({ path: dir })
})
afterAll(async () => {
  await t.close()
  await rm(dir, { recursive: true, force: true })
})

/** The image functions, faked and counted: the bytes here are labels, not PNGs. */
function fakeDiff() {
  const calls = { readPngInfo: 0, makeThumbnail: 0, diffImages: 0 }
  const diff = {
    readPngInfo: async (): Promise<readPngInfo.Info> => {
      calls.readPngInfo += 1
      return { width: 40, height: 30 }
    },
    makeThumbnail: async (png: Buffer): Promise<makeThumbnail.Result> => {
      calls.makeThumbnail += 1
      return { webp: Buffer.from(`thumb:${png.toString()}`), width: 4, height: 3 }
    },
    diffImages: async (base: Buffer, head: Buffer): Promise<diffImages.Result> => {
      calls.diffImages += 1
      return {
        base: { width: 40, height: 30 },
        head: { width: 40, height: 30 },
        width: 40,
        height: 30,
        sizeChanged: false,
        changedPixels: 1,
        score: 0.001,
        changed: true,
        diffPng: Buffer.from(`diff:${base.toString()}:${head.toString()}`),
        ignoredChangedPixels: 0,
        ignoredRegions: [],
      }
    },
  }
  return { diff, calls }
}

async function uploadBuild(
  projectId: string,
  build: { commitSha: string; branch: string; ancestorShas?: string[] },
  shots: Record<string, string>,
) {
  const created = await createBuild(t.db, { projectId, ...build })
  const entries = Object.entries(shots).map(([name, text]) => ({
    name,
    bytes: Buffer.from(text),
  }))
  const planned = await planUploads(t.db, {
    buildId: created.id,
    kind: 'screenshot',
    files: entries.map((e) => ({
      sha256: sha256(e.bytes),
      size: e.bytes.length,
      contentType: 'image/png',
    })),
    storageKeyFor: (s) => contentKey(s),
  })
  await Promise.all(
    planned.map(async (p) => {
      const bytes = entries.find((e) => sha256(e.bytes) === p.sha256)?.bytes
      if (!bytes) throw new Error('planned file not in the build')
      await storage.put(p.storageKey, bytes, { expectedSha256: p.sha256 })
      await markFileVerified(t.db, p.sha256, { size: bytes.length })
    }),
  )
  await finalizeBuild(t.db, {
    buildId: created.id,
    screenshots: entries.map((e) => ({ name: e.name, sha256: sha256(e.bytes) })),
  })
  return created
}

describe('processBuild image work', () => {
  it('does no image work for screenshots whose files were already processed', async () => {
    const { project, owner } = await seedProject(t.db)
    const shots = { home: 'home-bytes', login: 'login-bytes', same: 'home-bytes' }

    const first = fakeDiff()
    const b1 = await uploadBuild(project.id, { commitSha: 'aaa0001', branch: 'main' }, shots)
    await processBuild({ db: t.db, storage, diff: first.diff }, b1.id)
    await reviewBuild(t.db, { buildId: b1.id, userId: owner.id, state: 'approved' })
    // Two distinct files among three screenshots: each is read and encoded once.
    expect(first.calls).toEqual({ readPngInfo: 2, makeThumbnail: 2, diffImages: 0 })
    expect(await getFile(t.db, sha256(Buffer.from('home-bytes')))).toMatchObject({
      width: 40,
      height: 30,
      thumbnailSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
    })

    const second = fakeDiff()
    const get = vi.spyOn(storage, 'get')
    const b2 = await uploadBuild(
      project.id,
      { commitSha: 'aaa0002', branch: 'main', ancestorShas: ['aaa0001'] },
      shots,
    )
    await processBuild({ db: t.db, storage, diff: second.diff }, b2.id)
    // Identical files: no download, no decode, no encode, no pixel diff.
    expect(second.calls).toEqual({ readPngInfo: 0, makeThumbnail: 0, diffImages: 0 })
    expect(get).not.toHaveBeenCalled()
    get.mockRestore()

    // The screenshots still carry the thumbnail, copied from their file.
    const shotsOf = await listBuildScreenshots(t.db, b2.id)
    expect(shotsOf).toHaveLength(3)
    expect(shotsOf.every((s) => s.thumbnailSha256)).toBe(true)
    expect(await getBuild(t.db, b2.id)).toMatchObject({ conclusion: 'no_changes' })
  })

  it('writes the outcomes of changed pairs in a batch', async () => {
    const { project, owner } = await seedProject(t.db)
    const names = Array.from({ length: 12 }, (_, i) => `shot-${i}`)
    const before = Object.fromEntries(names.map((n) => [n, `${n}-v1`]))
    const after = Object.fromEntries(names.map((n) => [n, `${n}-v2`]))
    const f = fakeDiff()
    const b1 = await uploadBuild(project.id, { commitSha: 'bbb0001', branch: 'main' }, before)
    await processBuild({ db: t.db, storage, diff: f.diff, concurrency: 3 }, b1.id)
    await reviewBuild(t.db, { buildId: b1.id, userId: owner.id, state: 'approved' })
    const b2 = await uploadBuild(
      project.id,
      { commitSha: 'bbb0002', branch: 'main', ancestorShas: ['bbb0001'] },
      after,
    )
    await processBuild({ db: t.db, storage, diff: f.diff, concurrency: 3 }, b2.id)
    expect(f.calls.diffImages).toBe(12)
    const rows = await listBuildDiffs(t.db, b2.id)
    expect(rows).toHaveLength(12)
    expect(rows.every((r) => r.status === 'changed' && r.jobStatus === 'done')).toBe(true)
    expect(rows.every((r) => r.changedPixels === 1 && r.diffFileSha256)).toBe(true)
  })
})

/** Puts files in storage and the database, one per text, and returns their hashes. */
async function stored(texts: string[]): Promise<string[]> {
  return Promise.all(
    texts.map(async (text) => {
      const bytes = Buffer.from(text)
      const sha = sha256(bytes)
      const key = contentKey(sha)
      await storage.put(key, bytes, { expectedSha256: sha })
      await t.db.insert(files).values({
        sha256: sha,
        storageKey: key,
        kind: 'screenshot',
        status: 'verified',
        verifiedAt: new Date(),
        size: bytes.length,
      })
      return sha
    }),
  )
}

describe('createLoader', () => {
  it('frees a file after its last use and keeps the peak at what is in flight', async () => {
    const shas = await stored(['loader-a', 'loader-b', 'loader-c', 'loader-d'])
    // Four files, each read by two pairs, processed one pair at a time.
    const uses = new Map(shas.map((s) => [s, 2]))
    const get = vi.spyOn(storage, 'get')
    const load = createLoader(t.db, storage, uses)
    for (const sha of shas) {
      for (let pair = 0; pair < 2; pair += 1) {
        // oxlint-disable-next-line no-await-in-loop -- one pair at a time is the point
        await load(sha)
        load.release(sha)
        expect(load.size()).toBe(pair === 0 ? 1 : 0)
      }
    }
    expect(load.size()).toBe(0)
    expect(load.peak()).toBe(1)
    // Shared by the two pairs, so read once per file, not once per use.
    expect(get).toHaveBeenCalledTimes(4)
    get.mockRestore()
  })

  it('never holds more than the pairs in flight need', async () => {
    const shas = await stored(Array.from({ length: 20 }, (_, i) => `many-${i}`))
    const load = createLoader(t.db, storage, new Map(shas.map((s) => [s, 1])))
    // Four pairs at a time, as `concurrency` would run them.
    for (let i = 0; i < shas.length; i += 4) {
      const batch = shas.slice(i, i + 4)
      // oxlint-disable-next-line no-await-in-loop -- a batch finishes before the next starts
      await Promise.all(
        batch.map(async (sha) => {
          await load(sha)
          load.release(sha)
        }),
      )
    }
    expect(load.size()).toBe(0)
    expect(load.peak()).toBeLessThanOrEqual(4)
  })
})
