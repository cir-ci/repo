import { createHash } from 'node:crypto'
import { crc32, inflateRawSync } from 'node:zlib'

import { IngestError, type ingestTarball } from './ingest.ts'
import { contentTypeFor } from './mime.ts'
import { safeEntryPath, UnsafePathError } from './paths.ts'

/**
 * Reading a site from a `.zip` (what `actions/upload-artifact` makes). Same promise as
 * `ingestTarball`: the archive is untrusted, so only regular files and directories are accepted
 * (a symlink or special file anywhere rejects the whole archive), every path goes through
 * `safeEntryPath`, a duplicate path, encryption, ZIP64 or an unknown compression method is
 * refused, and the files, bytes and expansion ratio are limited.
 *
 * The zip is read from its central directory (the only place sizes can be trusted: entries written
 * as a stream carry them after the data). Each entry is inflated with `maxOutputLength`, so an
 * entry that lies about its size cannot expand past what the limits allow, then checked against
 * its declared size and CRC-32.
 */

const EOCD = 0x06054b50
const CENTRAL = 0x02014b50
const LOCAL = 0x04034b50
const S_IFMT = 0o170000
const S_IFREG = 0o100000
const S_IFDIR = 0o040000

interface Entry {
  name: string
  method: number
  crc: number
  compressedSize: number
  size: number
  offset: number
  /** Unix file type bits from the external attributes, 0 when the archive was not made on Unix. */
  mode: number
  isDirectory: boolean
}

/** The central directory's entries, or throws `invalid`. */
function readDirectory(zip: Buffer): Entry[] {
  // The end-of-central-directory record is within the last 64 KiB + 22 bytes (a trailing comment).
  let eocd = -1
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 22 - 0xffff); i--) {
    if (zip.readUInt32LE(i) === EOCD) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new IngestError('invalid', 'Not a readable zip archive')
  const count = zip.readUInt16LE(eocd + 10)
  const dirSize = zip.readUInt32LE(eocd + 12)
  const dirOffset = zip.readUInt32LE(eocd + 16)
  if (count === 0xffff || dirSize === 0xffffffff || dirOffset === 0xffffffff) {
    throw new IngestError('invalid', 'ZIP64 archives are not accepted')
  }
  if (dirOffset + dirSize > eocd) throw new IngestError('invalid', 'The zip directory is damaged')
  const entries: Entry[] = []
  let at = dirOffset
  for (let i = 0; i < count; i++) {
    if (at + 46 > zip.length || zip.readUInt32LE(at) !== CENTRAL) {
      throw new IngestError('invalid', 'The zip directory is damaged')
    }
    const flags = zip.readUInt16LE(at + 8)
    const nameLength = zip.readUInt16LE(at + 28)
    const extraLength = zip.readUInt16LE(at + 30)
    const commentLength = zip.readUInt16LE(at + 32)
    if (flags & 0x1) throw new IngestError('unsafe-entry', 'Encrypted zip entries are not accepted')
    const compressedSize = zip.readUInt32LE(at + 20)
    const size = zip.readUInt32LE(at + 24)
    const offset = zip.readUInt32LE(at + 42)
    if (compressedSize === 0xffffffff || size === 0xffffffff || offset === 0xffffffff) {
      throw new IngestError('invalid', 'ZIP64 archives are not accepted')
    }
    const name = zip.toString('utf8', at + 46, at + 46 + nameLength)
    const madeByUnix = zip.readUInt16LE(at + 4) >> 8 === 3
    const attributes = zip.readUInt32LE(at + 38)
    const mode = madeByUnix ? (attributes >>> 16) & S_IFMT : 0
    entries.push({
      name,
      method: zip.readUInt16LE(at + 10),
      crc: zip.readUInt32LE(at + 16),
      compressedSize,
      size,
      offset,
      mode,
      isDirectory: name.endsWith('/') || mode === S_IFDIR,
    })
    at += 46 + nameLength + extraLength + commentLength
  }
  return entries
}

/** Reads the zip and stores each file, like `ingestTarball` does for a tarball. */
export async function ingestZip(
  zip: Buffer,
  options: ingestTarball.Options,
): Promise<ingestTarball.File[]> {
  const maxFiles = options.maxFiles ?? 20_000
  const maxFileBytes = options.maxFileBytes ?? options.maxBytes
  const maxRatio = options.maxRatio ?? 100
  const entries = readDirectory(zip)
  const seen = new Set<string>()
  const result: ingestTarball.File[] = []
  const items: { file: ingestTarball.File; content: Buffer }[] = []
  let total = 0

  for (const entry of entries) {
    if (entry.isDirectory) {
      try {
        const bare = entry.name.replace(/\/+$/, '')
        if (bare !== '.' && bare !== '') safeEntryPath(entry.name)
      } catch (err) {
        if (err instanceof UnsafePathError) throw new IngestError('unsafe-path', err.message)
        throw err
      }
      continue
    }
    // `mode` is 0 for an archive not made on Unix: then only the name tells (a link has no marker).
    if (entry.mode !== 0 && entry.mode !== S_IFREG) {
      throw new IngestError(
        'unsafe-entry',
        `"${entry.name}" is a link or special file: only regular files and directories are accepted`,
      )
    }
    let path: string
    try {
      path = safeEntryPath(entry.name)
    } catch (err) {
      throw new IngestError('unsafe-path', err instanceof Error ? err.message : String(err))
    }
    if (seen.has(path)) throw new IngestError('duplicate', `"${path}" appears twice in the archive`)
    seen.add(path)
    if (seen.size > maxFiles) throw new IngestError('too-many-files', `More than ${maxFiles} files`)
    if (entry.size > maxFileBytes) {
      throw new IngestError('too-large', `"${path}" is larger than ${maxFileBytes} bytes`)
    }
    if (total + entry.size > options.maxBytes) {
      throw new IngestError('too-large', `The site is larger than ${options.maxBytes} bytes`)
    }
    if (entry.method !== 0 && entry.method !== 8) {
      throw new IngestError('invalid', `"${path}" uses a compression method CirCI can't read`)
    }
    const content = readEntry(zip, entry, path)
    total += content.length
    if (total > 1024 * 1024 && total > Math.max(zip.length, 1) * maxRatio) {
      throw new IngestError('bomb', 'The archive expands far more than a real site would')
    }
    const file: ingestTarball.File = {
      path,
      sha256: createHash('sha256').update(content).digest('hex'),
      size: content.length,
      contentType: contentTypeFor(path),
    }
    result.push(file)
    items.push({ file, content })
  }
  // Nothing is stored until the whole archive passed: a rejected one leaves no blobs behind.
  await Promise.all(items.map((item) => options.store(item.file, item.content)))
  return result
}

/** One entry's bytes, inflated within its declared size (already within the limits) and checked against its directory record. */
function readEntry(zip: Buffer, entry: Entry, path: string): Buffer {
  const at = entry.offset
  if (at + 30 > zip.length || zip.readUInt32LE(at) !== LOCAL) {
    throw new IngestError('invalid', `"${path}" is damaged in the archive`)
  }
  const start = at + 30 + zip.readUInt16LE(at + 26) + zip.readUInt16LE(at + 28)
  const end = start + entry.compressedSize
  if (end > zip.length) throw new IngestError('invalid', `"${path}" is cut short in the archive`)
  const data = zip.subarray(start, end)
  let content: Buffer
  if (entry.method === 0) {
    content = Buffer.from(data)
  } else {
    try {
      content = inflateRawSync(data, { maxOutputLength: Math.max(entry.size, 1) })
    } catch (err) {
      const tooBig =
        err instanceof RangeError || Reflect.get(Object(err), 'code') === 'ERR_BUFFER_TOO_LARGE'
      throw tooBig
        ? new IngestError('bomb', `"${path}" expands further than it says`)
        : new IngestError('invalid', `"${path}" can't be unpacked`)
    }
  }
  if (content.length !== entry.size || crc32(content) !== entry.crc) {
    throw new IngestError('invalid', `"${path}" doesn't match its checksum`)
  }
  return content
}
