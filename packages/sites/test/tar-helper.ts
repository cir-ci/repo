import { gzipSync } from 'node:zlib'

/** Builds ustar archives by hand, so tests can include entries a real `tar` would refuse to write. */
export interface TarEntry {
  name: string
  /** `0` file, `1` hard link, `2` symlink, `3` character device, `5` directory, `6` FIFO. */
  type?: '0' | '1' | '2' | '3' | '5' | '6'
  content?: Buffer | string
  linkname?: string
}

function header(entry: TarEntry, size: number): Buffer {
  const block = Buffer.alloc(512)
  block.write(entry.name, 0, 100, 'utf8')
  block.write('0000644\0', 100)
  block.write('0000000\0', 108)
  block.write('0000000\0', 116)
  block.write(`${size.toString(8).padStart(11, '0')}\0`, 124)
  block.write('00000000000\0', 136)
  block.write('        ', 148) // checksum placeholder: spaces
  block.write(entry.type ?? '0', 156)
  if (entry.linkname) block.write(entry.linkname, 157, 100, 'utf8')
  block.write('ustar\0', 257)
  block.write('00', 263)
  let sum = 0
  for (const byte of block) sum += byte
  block.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148)
  return block
}

export function makeTar(entries: TarEntry[]): Buffer {
  const parts: Buffer[] = []
  for (const entry of entries) {
    const content = Buffer.from(entry.content ?? '')
    const isFile = (entry.type ?? '0') === '0'
    parts.push(header(entry, isFile ? content.length : 0))
    if (isFile && content.length > 0) {
      parts.push(content, Buffer.alloc((512 - (content.length % 512)) % 512))
    }
  }
  parts.push(Buffer.alloc(1024))
  return Buffer.concat(parts)
}

export const makeTarGz = (entries: TarEntry[]) => gzipSync(makeTar(entries))
