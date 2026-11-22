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
import {
  InvalidImageError,
  type diffImages,
  type makeThumbnail,
  type readPngInfo,
} from '@circi/diff'
import { contentKey, FsStorage } from '@circi/storage'
import { sha256, useTempDir } from '@circi/testing'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { createLoader, finalizeBuild, processBuild, reviewBuild } from '#src/index.ts'

let t: createTestDb.Result
const tempDir = useTempDir('circi-pipeline')
let storage: FsStorage

beforeAll(async () => {
  t = await createTestDb()
  storage = new FsStorage({ path: tempDir.path })
})
afterAll(async () => {
  await t.close()
})

/** The image functions, faked and counted: the bytes here are labels, not PNGs. */
function fakeDiff(unreadable: string[] = []) {
  const calls = { readPngInfo: 0, makeThumbnail: 0, diffImages: 0 }
  const diff = {
    readPngInfo: async (png: Buffer): Promise<readPngInfo.Info> => {
      calls.readPngInfo += 1
      if (unreadable.includes(png.toString())) throw new InvalidImageError('not a PNG')
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

describe('processBuild with unreadable screenshots', () => {
  it('lets go of the baseline bytes of a pair whose head is unreadable', async () => {
    const { project, owner } = await seedProject(t.db)
    const b1 = await uploadBuild(
      project.id,
      { commitSha: 'ccc0001', branch: 'main' },
      { a: 'shared-base', b: 'shared-base' },
    )
    await processBuild({ db: t.db, storage, diff: fakeDiff().diff }, b1.id)
    await reviewBuild(t.db, { buildId: b1.id, userId: owner.id, state: 'approved' })

    // Both pairs read the same base file; the second one's head can't be read.
    const b2 = await uploadBuild(
      project.id,
      { commitSha: 'ccc0002', branch: 'feature', ancestorShas: ['ccc0001'] },
      { a: 'new-a', b: 'broken' },
    )
    let seen: { size(): number; peak(): number } | undefined
    await processBuild(
      {
        db: t.db,
        storage,
        diff: fakeDiff(['broken']).diff,
        concurrency: 1,
        onLoader: (l) => (seen = l),
      },
      b2.id,
    )
    const rows = await listBuildDiffs(t.db, b2.id)
    expect(rows.map((r) => [r.name, r.status])).toEqual([
      ['a', 'changed'],
      ['b', 'failed'],
    ])
    expect(seen?.size()).toBe(0)
  })

  it('treats a screenshot whose baseline is unreadable as added, not failed', async () => {
    const { project, owner } = await seedProject(t.db)
    const f1 = fakeDiff(['bad-bytes'])
    const b1 = await uploadBuild(
      project.id,
      { commitSha: 'ddd0001', branch: 'main' },
      { home: 'bad-bytes', other: 'other-bytes' },
    )
    await processBuild({ db: t.db, storage, diff: f1.diff }, b1.id)
    expect((await listBuildDiffs(t.db, b1.id)).map((r) => [r.name, r.status])).toEqual([
      ['home', 'failed'],
      ['other', 'added'],
    ])
    await reviewBuild(t.db, { buildId: b1.id, userId: owner.id, state: 'approved' })

    // The next build resolves b1 as its baseline; home is readable now.
    const f2 = fakeDiff(['bad-bytes'])
    const b2 = await uploadBuild(
      project.id,
      { commitSha: 'ddd0002', branch: 'feature', ancestorShas: ['ddd0001'] },
      { home: 'fine-bytes', other: 'other-bytes' },
    )
    await processBuild({ db: t.db, storage, diff: f2.diff }, b2.id)
    expect((await getBuild(t.db, b2.id))?.baseBuildId).toBe(b1.id)
    expect((await listBuildDiffs(t.db, b2.id)).map((r) => [r.name, r.status])).toEqual([
      ['home', 'added'],
      ['other', 'unchanged'],
    ])
    expect(f2.calls.diffImages).toBe(0)
  })

  it('does not auto-approve a default-branch build that has an unreadable screenshot', async () => {
    const { project, owner } = await seedProject(t.db)
    const b1 = await uploadBuild(
      project.id,
      { commitSha: 'eee0001', branch: 'main' },
      { home: 'home-v1', login: 'login-v1' },
    )
    await processBuild({ db: t.db, storage, diff: fakeDiff().diff }, b1.id)
    await reviewBuild(t.db, { buildId: b1.id, userId: owner.id, state: 'approved' })

    const good = await uploadBuild(
      project.id,
      { commitSha: 'eee0002', branch: 'main', ancestorShas: ['eee0001'] },
      { home: 'home-v2', login: 'login-v1' },
    )
    await processBuild({ db: t.db, storage, diff: fakeDiff().diff }, good.id)
    expect(await getBuild(t.db, good.id)).toMatchObject({ reviewStatus: 'approved' })

    const broken = await uploadBuild(
      project.id,
      { commitSha: 'eee0003', branch: 'main', ancestorShas: ['eee0002'] },
      { home: 'home-v3', login: 'login-broken' },
    )
    await processBuild({ db: t.db, storage, diff: fakeDiff(['login-broken']).diff }, broken.id)
    expect(await getBuild(t.db, broken.id)).toMatchObject({
      conclusion: 'changes_detected',
      reviewStatus: 'pending',
    })
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
