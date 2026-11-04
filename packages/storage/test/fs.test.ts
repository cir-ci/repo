import { createHash } from 'node:crypto'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { text } from 'node:stream/consumers'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  ChecksumMismatchError,
  contentKey,
  FsStorage,
  InvalidKeyError,
  ObjectNotFoundError,
} from '../src/index.ts'

const sha = (s: string) => createHash('sha256').update(s).digest('hex')

describe('FsStorage', () => {
  let dir: string
  let storage: FsStorage

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'circi-fs-'))
    storage = new FsStorage({ path: dir })
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('round-trips bytes and reports size and sha256', async () => {
    const key = contentKey(sha('hello'))
    const res = await storage.put(key, Buffer.from('hello'))
    expect(res).toEqual({ size: 5, sha256: sha('hello') })
    expect(await text(await storage.get(key))).toBe('hello')
    expect(await storage.head(key)).toEqual({ size: 5 })
  })

  it('accepts streams', async () => {
    const res = await storage.put('a/b', Readable.from(['he', 'llo']), {
      expectedSha256: sha('hello'),
    })
    expect(res.sha256).toBe(sha('hello'))
  })

  it('stores nothing when the checksum does not match', async () => {
    const key = 'x/y'
    await expect(
      storage.put(key, Buffer.from('evil'), { expectedSha256: sha('hello') }),
    ).rejects.toBeInstanceOf(ChecksumMismatchError)
    expect(await storage.head(key)).toBeNull()
    expect(await readdir(join(dir, '.tmp'))).toEqual([])
  })

  it('reports missing objects', async () => {
    expect(await storage.head('nope')).toBeNull()
    await expect(storage.get('nope')).rejects.toBeInstanceOf(ObjectNotFoundError)
  })

  it('deletes idempotently', async () => {
    await storage.put('k', Buffer.from('x'))
    await storage.delete('k')
    await storage.delete('k')
    expect(await storage.head('k')).toBeNull()
  })

  it.each(['../etc/passwd', 'a/../../b', '/abs', 'a//b', 'a/./b', '.tmp/x', '', 'a b'])(
    'refuses unsafe key %j',
    async (key) => {
      await expect(storage.put(key, Buffer.from('x'))).rejects.toBeInstanceOf(InvalidKeyError)
    },
  )

  it('passes its health check on a writable directory', async () => {
    await expect(storage.healthCheck()).resolves.toBeUndefined()
  })
})

describe('contentKey', () => {
  it('fans out by hash prefix and adds a generation', () => {
    const h = sha('x')
    const key = contentKey(h, 'gen-1')
    expect(key).toBe(`${h.slice(0, 2)}/${h.slice(2, 4)}/${h}/gen-1`)
    expect(contentKey(h)).not.toBe(contentKey(h))
  })

  it('rejects anything that is not a lowercase hex sha256', () => {
    expect(() => contentKey('ABC')).toThrow(/Not a lowercase hex sha256/)
  })
})
