import { createHash } from 'node:crypto'
import { Readable } from 'node:stream'

import { describe, expect, it } from 'vitest'

import { IngestError, type IngestedFile, ingestTarball } from '../src/index.ts'
import { makeTarGz, type TarEntry } from './tar-helper.ts'

async function ingest(
  entries: TarEntry[],
  over: Partial<Parameters<typeof ingestTarball>[1]> = {},
) {
  const stored = new Map<string, Buffer>()
  const files = await ingestTarball(Readable.from([makeTarGz(entries)]), {
    maxBytes: 10 * 1024 * 1024,
    store: async (f: IngestedFile, content: Buffer) => void stored.set(f.sha256, content),
    ...over,
  })
  return { files, stored }
}

const failure = (entries: TarEntry[], over = {}) => ingest(entries, over).catch((e: unknown) => e)

describe('ingestTarball', () => {
  it('reads a site: paths, hashes, sizes and content types, storing each file once', async () => {
    const { files, stored } = await ingest([
      { name: './', type: '5' },
      { name: './index.html', content: '<h1>hi</h1>' },
      { name: 'assets/', type: '5' },
      { name: 'assets/app.js', content: 'console.log(1)' },
      { name: 'assets/copy.js', content: 'console.log(1)' },
    ])
    expect(files.map((f) => f.path).toSorted((a, b) => a.localeCompare(b))).toEqual([
      'assets/app.js',
      'assets/copy.js',
      'index.html',
    ])
    const index = files.find((f) => f.path === 'index.html')
    expect(index).toMatchObject({
      sha256: createHash('sha256').update('<h1>hi</h1>').digest('hex'),
      size: 11,
      contentType: 'text/html; charset=utf-8',
    })
    expect(stored.size).toBe(2) // two identical files, one blob
    expect(files.find((f) => f.path === 'assets/app.js')?.contentType).toContain('javascript')
  })

  it.each([
    ['a symlink', { name: 'link', type: '2', linkname: '/etc/passwd' }],
    ['a hard link', { name: 'hard', type: '1', linkname: 'index.html' }],
    ['a device', { name: 'dev', type: '3' }],
    ['a FIFO', { name: 'pipe', type: '6' }],
  ] as const)('rejects the whole upload for %s', async (_what, entry) => {
    expect(await failure([{ name: 'index.html', content: 'ok' }, entry])).toMatchObject({
      name: 'IngestError',
      code: 'unsafe-entry',
    })
  })

  it.each([
    '../escape.html',
    'a/../../escape.html',
    '/abs/path.html',
    'a\\b.html',
    '_circi/nav.js',
    './_circi/evil.js',
  ])('rejects the path %j', async (name) => {
    expect(await failure([{ name, content: 'x' }])).toMatchObject({
      name: 'IngestError',
      code: 'unsafe-path',
    })
  })

  it('rejects a directory entry that leaves the site', async () => {
    expect(await failure([{ name: '../outside/', type: '5' }])).toMatchObject({
      name: 'IngestError',
      code: 'unsafe-path',
    })
  })

  it('rejects the same path twice', async () => {
    const err = await failure([
      { name: 'a.html', content: '1' },
      { name: './a.html', content: '2' },
    ])
    expect(err).toMatchObject({ name: 'IngestError', code: 'duplicate' })
  })

  it('rejects too many files', async () => {
    const err = await failure(
      [
        { name: 'a', content: '1' },
        { name: 'b', content: '2' },
        { name: 'c', content: '3' },
      ],
      { maxFiles: 2 },
    )
    expect(err).toMatchObject({ name: 'IngestError', code: 'too-many-files' })
  })

  it('rejects a file, or a whole site, that is too big', async () => {
    const bigFile = await failure([{ name: 'big.bin', content: Buffer.alloc(2000) }], {
      maxFileBytes: 1000,
    })
    expect(bigFile).toMatchObject({ name: 'IngestError', code: 'too-large' })
    const bigSite = await failure(
      [
        { name: 'a.bin', content: Buffer.alloc(800) },
        { name: 'b.bin', content: Buffer.alloc(800) },
      ],
      { maxBytes: 1500 },
    )
    expect(bigSite).toMatchObject({ name: 'IngestError', code: 'too-large' })
  })

  it('stops a compression bomb before it fills memory', async () => {
    // 60 MB of zeros compresses to a few KB: far beyond the allowed expansion.
    const err = await failure([{ name: 'zeros.bin', content: Buffer.alloc(60 * 1024 * 1024) }], {
      maxBytes: 200 * 1024 * 1024,
    })
    expect(err).toMatchObject({ name: 'IngestError', code: 'bomb' })
  })

  it('yields no files for something that is not an archive', async () => {
    const out = await ingestTarball(
      Readable.from([Buffer.from('definitely not a tarball, just text')]),
      {
        maxBytes: 1024,
        store: async () => {},
      },
    ).catch((e: unknown) => e)
    expect(Array.isArray(out) ? out : []).toEqual([])
  })
})
