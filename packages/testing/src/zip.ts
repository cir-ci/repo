import { crc32, deflateRawSync } from 'node:zlib'

/** One entry of a hand-built zip, so tests can include what a real archiver would refuse to write. */
export interface ZipEntry {
  name: string
  content?: Buffer | string
  /** `file` (default), `dir`, `symlink` (content is the target) or `fifo`. */
  type?: 'file' | 'dir' | 'symlink' | 'fifo'
  /** Store without compression (default: deflate). */
  stored?: boolean
  /** The uncompressed size written in the directory, when it should differ from the real one. */
  declaredSize?: number
  /** Written as an archive made on Windows: no Unix file type, so a symlink can't be told. */
  windows?: boolean
}

const MODES = { file: 0o100644, dir: 0o040755, symlink: 0o120777, fifo: 0o010644 } as const

/** Builds a zip the way `actions/upload-artifact` does (deflate, a Unix host, a central directory). */
export function makeZip(entries: ZipEntry[]): Buffer {
  const parts: Buffer[] = []
  const directory: Buffer[] = []
  let offset = 0
  for (const entry of entries) {
    const type = entry.type ?? 'file'
    const raw = Buffer.from(entry.content ?? '')
    const data = type === 'dir' || entry.stored ? raw : deflateRawSync(raw)
    const method = type === 'dir' || entry.stored ? 0 : 8
    const name = Buffer.from(
      type === 'dir' && !entry.name.endsWith('/') ? `${entry.name}/` : entry.name,
    )
    const crc = crc32(raw)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(method, 8)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(raw.length, 22)
    local.writeUInt16LE(name.length, 26)
    parts.push(local, name, data)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(entry.windows ? 20 : (3 << 8) | 20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(method, 10)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(data.length, 20)
    central.writeUInt32LE(entry.declaredSize ?? raw.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt32LE(entry.windows ? 0 : (MODES[type] << 16) >>> 0, 38)
    central.writeUInt32LE(offset, 42)
    directory.push(central, name)
    offset += local.length + name.length + data.length
  }
  const size = directory.reduce((n, b) => n + b.length, 0)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(size, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...parts, ...directory, end])
}
