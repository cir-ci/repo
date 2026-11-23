import { createHash } from 'node:crypto'
import { Readable } from 'node:stream'

import { getFile } from '@circi/db/queries'
import { createTestDb, seedProject } from '@circi/db/testing'
import { ChecksumMismatchError, FsStorage } from '@circi/storage'
import { useTempDir } from '@circi/testing'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import {
  finalizeProjectBuild,
  findUpload,
  getBuildStatus,
  startBuildUpload,
  storeUpload,
} from '#src/index.ts'

let t: createTestDb.Result
const tempDir = useTempDir('circi-uploads')
let storage: FsStorage
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(async () => {
  await t.close()
})
beforeEach(async () => {
  storage = new FsStorage({ path: tempDir.path })
})
afterEach(async () => {})

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex')
const bytes = (text: string) => Readable.from([Buffer.from(text)])

async function start(text = 'png-bytes') {
  const { project } = await seedProject(t.db)
  const sha = sha256(`${text}-${project.id}`)
  const started = await startBuildUpload(t.db, {
    build: { projectId: project.id, commitSha: 'abc1234' },
    files: [{ sha256: sha, size: 0, contentType: 'image/png' }],
    storageKeyFor: (s) => `files/${s}`,
  })
  return { project, sha, ...started }
}

describe('startBuildUpload', () => {
  it('creates the build and the claims on its files together', async () => {
    const { build, planned, sha } = await start()
    expect(build.status).toBe('uploading')
    expect(planned).toEqual([
      { sha256: sha, storageKey: `files/${sha}`, size: 0, contentType: 'image/png' },
    ])
    expect((await findUpload(t.db, { sha256: sha, buildId: build.id })).state).toBe('pending')
  })
})

describe('findUpload and storeUpload', () => {
  it('knows nothing of a file no build asked for, or one another build asked for', async () => {
    const { build, sha } = await start()
    expect(await findUpload(t.db, { sha256: sha256('nobody') })).toEqual({ state: 'unknown' })
    const other = await start('other')
    expect(await findUpload(t.db, { sha256: other.sha, buildId: build.id })).toEqual({
      state: 'unknown',
    })
    expect(sha).not.toBe(other.sha)
  })

  it('stores the bytes and marks the file verified; the next ask says verified', async () => {
    const { project } = await seedProject(t.db)
    const content = 'hello'
    const sha = sha256(content)
    await startBuildUpload(t.db, {
      build: { projectId: project.id, commitSha: 'abc1234' },
      files: [{ sha256: sha, size: 0, contentType: 'image/png' }],
      storageKeyFor: (s) => `files/${s}`,
    })
    const found = await findUpload(t.db, { sha256: sha })
    if (found.state !== 'pending') throw new Error('expected pending')
    const stored = await storeUpload(t.db, storage, {
      sha256: sha,
      storageKey: found.storageKey,
      contentType: found.contentType,
      content: bytes(content),
    })
    expect(stored).toEqual({ status: 'verified', size: 5 })
    expect(await findUpload(t.db, { sha256: sha })).toEqual({ state: 'verified' })
    expect((await getFile(t.db, sha))?.size).toBe(5)
  })

  it("leaves the file pending when the bytes don't match or the caller refuses them", async () => {
    const { sha } = await start()
    const found = await findUpload(t.db, { sha256: sha })
    if (found.state !== 'pending') throw new Error('expected pending')
    const input = { sha256: sha, storageKey: found.storageKey, contentType: found.contentType }
    await expect(
      storeUpload(t.db, storage, { ...input, content: bytes('not the right bytes') }),
    ).rejects.toBeInstanceOf(ChecksumMismatchError)
    expect((await findUpload(t.db, { sha256: sha })).state).toBe('pending')
  })

  it("doesn't mark a file the caller rejected after storing it", async () => {
    const { project } = await seedProject(t.db)
    const sha = sha256('cut')
    await startBuildUpload(t.db, {
      build: { projectId: project.id, commitSha: 'abc1234' },
      files: [{ sha256: sha, size: 0, contentType: 'image/png' }],
      storageKeyFor: (s) => `files/${s}`,
    })
    const stored = await storeUpload(t.db, storage, {
      sha256: sha,
      storageKey: `files/${sha}`,
      contentType: null,
      content: bytes('cut'),
      accept: () => false,
    })
    expect(stored).toEqual({ status: 'rejected' })
    expect((await findUpload(t.db, { sha256: sha })).state).toBe('pending')
  })
})

describe('finalizeProjectBuild', () => {
  it("isn't-found for a build of another project", async () => {
    const { build } = await start()
    const other = await seedProject(t.db)
    const res = await finalizeProjectBuild(t.db, {
      projectId: other.project.id,
      buildId: build.id,
      shard: { screenshots: [] },
    })
    expect(res).toEqual({ status: 'not-found' })
  })

  it('reports files that were never uploaded as missing', async () => {
    const { project, build, sha } = await start()
    const res = await finalizeProjectBuild(t.db, {
      projectId: project.id,
      buildId: build.id,
      shard: { screenshots: [{ name: 'home', sha256: sha }] },
    })
    expect(res).toEqual({ status: 'missing', missing: [sha] })
  })

  it('finalizes the build once its files are verified', async () => {
    const { project, build, sha } = await start('x')
    await storeUpload(t.db, storage, {
      sha256: sha,
      storageKey: `files/${sha}`,
      contentType: null,
      content: bytes('x-' + project.id),
    })
    const res = await finalizeProjectBuild(t.db, {
      projectId: project.id,
      buildId: build.id,
      shard: { screenshots: [{ name: 'home', sha256: sha }] },
    })
    expect(res).toMatchObject({ status: 'ok', complete: true, shardsTotal: 1 })
    if (res.status !== 'ok') return
    expect(res.build.status).toBe('processing')
  })
})

describe('getBuildStatus', () => {
  it('is undefined for a build of another project', async () => {
    const { build } = await start()
    const other = await seedProject(t.db)
    expect(
      await getBuildStatus(t.db, {
        projectId: other.project.id,
        buildId: build.id,
        gitHostReports: false,
      }),
    ).toBeUndefined()
  })

  it('gates on the CI job unless a git host reports, and honours an override', async () => {
    const { project, build } = await start()
    const input = { projectId: project.id, buildId: build.id }
    expect(await getBuildStatus(t.db, { ...input, gitHostReports: true })).toMatchObject({
      gate: 'exit-code',
      counts: expect.any(Object),
    })
    expect(
      await getBuildStatus(t.db, { ...input, gitHostReports: false, gate: 'status' }),
    ).toMatchObject({ gate: 'status' })
  })
})
