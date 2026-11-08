import { createHash } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'

import { getFile } from '@circi/db'
import { FsStorage } from '@circi/storage'
import { createTestDb, seedFile, type TestDb } from '@circi/testing'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { createLoader, readAll, storeServerFile } from '#lib/files.ts'

let t: TestDb
let dir: string
let storage: FsStorage

beforeAll(async () => {
  t = await createTestDb()
  dir = await mkdtemp(join(tmpdir(), 'circi-worker-files-'))
  storage = new FsStorage({ path: dir })
})
afterAll(async () => {
  await t.close()
  await rm(dir, { recursive: true, force: true })
})

const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex')
const meta = { kind: 'thumbnail', contentType: 'image/png', width: 2, height: 3 } as const

describe('readAll', () => {
  it('joins the chunks of a stream, whether strings or buffers', async () => {
    expect((await readAll(Readable.from([Buffer.from('ab'), Buffer.from('cd')]))).toString()).toBe(
      'abcd',
    )
    expect((await readAll(Readable.from(['ab', 'cd']))).toString()).toBe('abcd')
  })
})

describe('storeServerFile', () => {
  it('stores bytes under their hash and records a verified file row', async () => {
    const bytes = Buffer.from('thumbnail bytes')
    const hash = await storeServerFile(t.db, storage, bytes, meta)
    expect(hash).toBe(sha(bytes))
    expect(await getFile(t.db, hash)).toMatchObject({
      status: 'verified',
      kind: 'thumbnail',
      size: bytes.length,
      contentType: 'image/png',
      width: 2,
      height: 3,
      storageKey: expect.stringContaining(hash),
    })
    expect(await readAll(await storage.get((await getFile(t.db, hash))?.storageKey ?? ''))).toEqual(
      bytes,
    )
  })

  it('does not store the same bytes twice', async () => {
    const bytes = Buffer.from('same bytes')
    await storeServerFile(t.db, storage, bytes, meta)
    const put = vi.spyOn(storage, 'put')
    expect(await storeServerFile(t.db, storage, bytes, meta)).toBe(sha(bytes))
    expect(put).not.toHaveBeenCalled()
    put.mockRestore()
  })
})

describe('createLoader', () => {
  it('reads a file’s bytes through its storage key', async () => {
    const bytes = Buffer.from('loaded')
    const hash = await storeServerFile(t.db, storage, bytes, meta)
    expect(await createLoader(t.db, storage)(hash)).toEqual(bytes)
  })

  it('reads each file once, even when asked for it several times', async () => {
    const bytes = Buffer.from('loaded once')
    const hash = await storeServerFile(t.db, storage, bytes, meta)
    const get = vi.spyOn(storage, 'get')
    const load = createLoader(t.db, storage)
    const [a, b] = await Promise.all([load(hash), load(hash)])
    expect(a).toEqual(bytes)
    expect(b).toBe(a)
    expect(get).toHaveBeenCalledTimes(1)
    get.mockRestore()
  })

  it('says so when the database has no such file', async () => {
    await expect(createLoader(t.db, storage)('f'.repeat(64))).rejects.toThrow(
      /missing from the database/,
    )
  })

  it('fails when the row exists but the bytes are gone from storage', async () => {
    const hash = 'e'.repeat(64)
    await seedFile(t.db, { sha256: hash })
    await expect(createLoader(t.db, storage)(hash)).rejects.toThrow(/Object not found/)
  })
})
