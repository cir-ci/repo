import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { access, mkdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'

import { errorCode } from '@circi/core'

import { assertSha256Hex, assertValidKey } from './keys.ts'
import { ChecksumMismatchError, ObjectNotFoundError, type StorageDriver } from './types.ts'

export namespace FsStorage {
  export interface Options {
    /** Directory that holds all objects, e.g. a Docker volume at /var/lib/circi/files. */
    path: string
  }
}

/**
 * Local-disk storage (PLAN §2 default). Writes go to `<root>/.tmp` and are renamed into
 * place only after the hash checks out, so a reader never sees a partial or wrong object.
 */
export class FsStorage implements StorageDriver {
  readonly kind = 'fs' as const
  readonly root: string
  private readonly tmpDir: string

  constructor(options: FsStorage.Options) {
    this.root = resolve(options.path)
    this.tmpDir = join(this.root, '.tmp')
  }

  private pathFor(key: string): string {
    assertValidKey(key)
    const full = resolve(this.root, key)
    if (!full.startsWith(this.root + sep)) throw new Error(`Key escapes storage root: ${key}`)
    return full
  }

  async put(
    key: string,
    body: Readable | Uint8Array,
    options: StorageDriver.PutOptions = {},
  ): Promise<StorageDriver.PutResult> {
    const target = this.pathFor(key)
    if (options.expectedSha256) assertSha256Hex(options.expectedSha256)
    await mkdir(this.tmpDir, { recursive: true })
    const tmp = join(this.tmpDir, randomUUID())

    const hash = createHash('sha256')
    let size = 0
    const meter = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        hash.update(chunk)
        size += chunk.length
        cb(null, chunk)
      },
    })

    try {
      const source = body instanceof Uint8Array ? Readable.from([Buffer.from(body)]) : body
      await pipeline(source, meter, createWriteStream(tmp, { flags: 'wx' }))
      const sha256 = hash.digest('hex')
      if (options.expectedSha256 && sha256 !== options.expectedSha256) {
        throw new ChecksumMismatchError(options.expectedSha256, sha256)
      }
      await mkdir(dirname(target), { recursive: true })
      await rename(tmp, target)
      return { size, sha256 }
    } finally {
      await rm(tmp, { force: true })
    }
  }

  async get(key: string): Promise<Readable> {
    const path = this.pathFor(key)
    try {
      await access(path)
    } catch {
      throw new ObjectNotFoundError(key)
    }
    return createReadStream(path)
  }

  async head(key: string): Promise<StorageDriver.ObjectInfo | null> {
    try {
      const s = await stat(this.pathFor(key))
      return s.isFile() ? { size: s.size } : null
    } catch (err) {
      if (errorCode(err) === 'ENOENT') return null
      throw err
    }
  }

  async delete(key: string): Promise<void> {
    await rm(this.pathFor(key), { force: true })
  }

  async healthCheck(): Promise<void> {
    await mkdir(this.tmpDir, { recursive: true })
    const probe = join(this.tmpDir, `health-${randomUUID()}`)
    await writeFile(probe, 'ok')
    await rm(probe, { force: true })
  }
}
