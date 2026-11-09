import { createHash } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'

import { getFile, getTeamBuild } from '@circi/db'
import { ChecksumMismatchError, FsStorage } from '@circi/storage'
import { createTestDb, seedTeam } from '@circi/testing'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import {
  finalizeTeamBuild,
  findUpload,
  getBuildStatus,
  startBuildUpload,
  storeUpload,
} from '#src/index.ts'

let t: createTestDb.Result
let dir: string
let storage: FsStorage
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(async () => {
  await t.close()
})
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'circi-uploads-'))
  storage = new FsStorage({ path: dir })
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex')
const bytes = (text: string) => Readable.from([Buffer.from(text)])

async function start(text = 'png-bytes') {
  const { team } = await seedTeam(t.db)
  const sha = sha256(`${text}-${team.id}`)
  const started = await startBuildUpload(t.db, {
    build: { teamId: team.id, commitSha: 'abc1234' },
    files: [{ sha256: sha, size: 0, contentType: 'image/png' }],
    storageKeyFor: (s) => `files/${s}`,
  })
  return { team, sha, ...started }
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
    const { team } = await seedTeam(t.db)
    const content = 'hello'
    const sha = sha256(content)
    await startBuildUpload(t.db, {
      build: { teamId: team.id, commitSha: 'abc1234' },
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

  it('leaves the file pending when the bytes do not match or the caller refuses them', async () => {
    const { sha } = await start()
    const found = await findUpload(t.db, { sha256: sha })
    if (found.state !== 'pending') throw new Error('expected pending')
    const input = { sha256: sha, storageKey: found.storageKey, contentType: found.contentType }
    await expect(
      storeUpload(t.db, storage, { ...input, content: bytes('not the right bytes') }),
    ).rejects.toBeInstanceOf(ChecksumMismatchError)
    expect((await findUpload(t.db, { sha256: sha })).state).toBe('pending')
  })

  it('does not mark a file the caller rejected after storing it', async () => {
    const { team } = await seedTeam(t.db)
    const sha = sha256('cut')
    await startBuildUpload(t.db, {
      build: { teamId: team.id, commitSha: 'abc1234' },
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

describe('finalizeTeamBuild', () => {
  it('is not-found for a build of another team', async () => {
    const { build } = await start()
    const other = await seedTeam(t.db)
    const res = await finalizeTeamBuild(t.db, {
      teamId: other.team.id,
      buildId: build.id,
      shard: { screenshots: [] },
    })
    expect(res).toEqual({ status: 'not-found' })
  })

  it('reports files that were never uploaded as missing', async () => {
    const { team, build, sha } = await start()
    const res = await finalizeTeamBuild(t.db, {
      teamId: team.id,
      buildId: build.id,
      shard: { screenshots: [{ name: 'home', sha256: sha }] },
    })
    expect(res).toEqual({ status: 'missing', missing: [sha] })
  })

  it('finalizes the build once its files are verified', async () => {
    const { team, build, sha } = await start('x')
    await storeUpload(t.db, storage, {
      sha256: sha,
      storageKey: `files/${sha}`,
      contentType: null,
      content: bytes('x-' + team.id),
    })
    const res = await finalizeTeamBuild(t.db, {
      teamId: team.id,
      buildId: build.id,
      shard: { screenshots: [{ name: 'home', sha256: sha }] },
    })
    expect(res).toMatchObject({ status: 'ok', complete: true, shardsTotal: 1 })
    if (res.status !== 'ok') return
    expect(res.build.status).toBe('processing')
  })

  it('refuses a manual-finalization total and applies a real one', async () => {
    const { team } = await seedTeam(t.db)
    const { build } = await startBuildUpload(t.db, {
      build: { teamId: team.id, commitSha: 'abc1234', parallel: { nonce: 'n', total: 8 } },
      files: [],
      storageKeyFor: (s) => s,
    })
    const input = { teamId: team.id, buildId: build.id, shard: { screenshots: [], hold: true } }
    await expect(finalizeTeamBuild(t.db, { ...input, parallelTotal: -1 })).rejects.toThrow(
      /not supported/,
    )
    await finalizeTeamBuild(t.db, { ...input, parallelTotal: 3 })
    expect((await getTeamBuild(t.db, team.id, build.id))?.parallelTotal).toBe(3)
  })
})

describe('getBuildStatus', () => {
  it('is undefined for a build of another team', async () => {
    const { build } = await start()
    const other = await seedTeam(t.db)
    expect(
      await getBuildStatus(t.db, {
        teamId: other.team.id,
        buildId: build.id,
        gitHostReports: false,
      }),
    ).toBeUndefined()
  })

  it('gates on the CI job unless a git host reports, and honours an override', async () => {
    const { team, build } = await start()
    const input = { teamId: team.id, buildId: build.id }
    expect(await getBuildStatus(t.db, { ...input, gitHostReports: true })).toMatchObject({
      gate: 'exit-code',
      counts: expect.any(Object),
    })
    expect(
      await getBuildStatus(t.db, { ...input, gitHostReports: false, gate: 'status' }),
    ).toMatchObject({ gate: 'status' })
  })
})
