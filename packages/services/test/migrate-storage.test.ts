import { createHash } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'

import { ensureAssetFiles } from '@circi/db'
import { FsStorage, type StorageDriver } from '@circi/storage'
import { createTestDb, type TestDb } from '@circi/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { migrateStorage } from '../src/index.ts'

let t: TestDb
let dir: string
let from: FsStorage
let to: FsStorage
const stored: { sha: string; key: string }[] = []

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex')

beforeAll(async () => {
  t = await createTestDb()
  dir = await mkdtemp(join(tmpdir(), 'circi-migrate-'))
  from = new FsStorage({ path: join(dir, 'from') })
  to = new FsStorage({ path: join(dir, 'to') })
  await Promise.all(
    ['one', 'two', 'three'].map(async (text) => {
      const sha = sha256(text)
      const key = `${sha.slice(0, 2)}/${sha}/gen`
      await from.put(key, Readable.from([Buffer.from(text)]), { expectedSha256: sha })
      await ensureAssetFiles(t.db, [
        { sha256: sha, size: text.length, storageKey: key, contentType: 'text/plain' },
      ])
      stored.push({ sha, key })
    }),
  )
})
afterAll(async () => {
  await t.close()
  await rm(dir, { recursive: true, force: true })
})

describe('migrateStorage', () => {
  it('copies every file under its own key, checked against its hash', async () => {
    const result = await migrateStorage(t.db, { from, to, batch: 2 })
    expect(result).toMatchObject({ copied: 3, skipped: 0, missing: [], failed: [] })
    const heads = await Promise.all(stored.map(({ key }) => to.head(key)))
    expect(heads.every((h) => h !== null)).toBe(true)
  })

  it('does nothing the second time, so an interrupted run resumes', async () => {
    expect(await migrateStorage(t.db, { from, to })).toMatchObject({ copied: 0, skipped: 3 })
  })

  it('reports a file the source no longer has instead of stopping', async () => {
    const lost = stored[0]
    if (!lost) throw new Error('no files')
    await to.delete(lost.key)
    await from.delete(lost.key)
    const result = await migrateStorage(t.db, { from, to })
    expect(result.missing).toEqual([lost.sha])
    expect(result.skipped).toBe(2)
  })

  it('reports progress as it goes', async () => {
    const seen: number[] = []
    await migrateStorage(t.db, { from, to, onFile: (n) => void seen.push(n) })
    expect(seen).toEqual([1, 2, 3])
  })

  it('copies again an object whose recorded checksum is not the file’s (a corrupt target)', async () => {
    const victim = stored[1]
    if (!victim) throw new Error('no files')
    const size = (await to.head(victim.key))?.size ?? 0
    // A target like S3 that knows each object's checksum: this one holds same-size wrong bytes.
    const checksummed: StorageDriver = {
      kind: 'fs',
      put: (key, body, options) => to.put(key, body, options),
      get: (key) => to.get(key),
      delete: (key) => to.delete(key),
      healthCheck: () => to.healthCheck(),
      head: async (key) => {
        const info = await to.head(key)
        return info && key === victim.key ? { ...info, size, sha256: sha256('corrupt') } : info
      },
    }
    const result = await migrateStorage(t.db, { from, to: checksummed })
    expect(result).toMatchObject({ copied: 1, failed: [] })
  })
})
