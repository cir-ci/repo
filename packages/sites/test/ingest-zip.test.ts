import { createHash } from 'node:crypto'

import { makeZip, type ZipEntry } from '@circi/testing'
import { describe, expect, it } from 'vitest'

import { ingestZip } from '#src/index.ts'

async function ingest(entries: ZipEntry[], over: Partial<Parameters<typeof ingestZip>[1]> = {}) {
  const stored = new Map<string, Buffer>()
  const files = await ingestZip(makeZip(entries), {
    maxBytes: 10 * 1024 * 1024,
    store: async (f, content) => void stored.set(f.sha256, content),
    ...over,
  })
  return { files, stored }
}

const failure = (entries: ZipEntry[], over = {}) => ingest(entries, over).catch((e: unknown) => e)

describe('ingestZip', () => {
  it('reads a site: paths, hashes, sizes and content types, storing each file once', async () => {
    const { files, stored } = await ingest([
      { name: 'assets/', type: 'dir' },
      { name: 'index.html', content: '<h1>hi</h1>' },
      { name: 'assets/app.js', content: 'console.log(1)' },
      { name: 'assets/copy.js', content: 'console.log(1)', stored: true },
    ])
    expect(files.map((f) => f.path).toSorted((a, b) => a.localeCompare(b))).toEqual([
      'assets/app.js',
      'assets/copy.js',
      'index.html',
    ])
    expect(files.find((f) => f.path === 'index.html')).toMatchObject({
      sha256: createHash('sha256').update('<h1>hi</h1>').digest('hex'),
      size: 11,
      contentType: 'text/html; charset=utf-8',
    })
    expect(stored.size).toBe(2)
  })

  it.each([
    ['a symlink', { name: 'link', type: 'symlink', content: '/etc/passwd' }],
    ['a FIFO', { name: 'pipe', type: 'fifo' }],
  ] as const)('rejects the whole archive for %s', async (_what, entry) => {
    expect(await failure([{ name: 'index.html', content: 'ok' }, entry])).toMatchObject({
      name: 'IngestError',
      code: 'unsafe-entry',
    })
  })

  it.each([
    ['..', '../evil.html'],
    ['nested ..', 'a/../../evil.html'],
    ['absolute', '/etc/evil.html'],
    ['backslash', 'a\\evil.html'],
    ['reserved prefix', '_circi/x.js'],
  ])('rejects a %s path', async (_what, name) => {
    expect(await failure([{ name, content: 'x' }])).toMatchObject({ code: 'unsafe-path' })
  })

  it('rejects an unsafe directory entry and a duplicate path', async () => {
    expect(await failure([{ name: '../up/', type: 'dir' }])).toMatchObject({ code: 'unsafe-path' })
    expect(
      await failure([
        { name: 'a.html', content: '1' },
        { name: './a.html', content: '2' },
      ]),
    ).toMatchObject({ code: 'duplicate' })
  })

  it('enforces the limits: bytes, one file, file count, expansion ratio', async () => {
    const big = 'x'.repeat(2000)
    expect(await failure([{ name: 'a', content: big }], { maxBytes: 1000 })).toMatchObject({
      code: 'too-large',
    })
    expect(
      await failure([{ name: 'a', content: big }], { maxFileBytes: 1000, maxBytes: 5000 }),
    ).toMatchObject({ code: 'too-large' })
    expect(
      await failure(
        [
          { name: 'a', content: '1' },
          { name: 'b', content: '2' },
        ],
        { maxFiles: 1 },
      ),
    ).toMatchObject({ code: 'too-many-files' })
    // Two MB of zeros deflate to a few KB: far above a ratio of 100.
    expect(
      await failure([{ name: 'zeros', content: Buffer.alloc(2 * 1024 * 1024) }]),
    ).toMatchObject({ code: 'bomb' })
  })

  it('does not trust a size the directory understates', async () => {
    expect(
      await failure([{ name: 'a.txt', content: 'x'.repeat(5000), declaredSize: 10 }]),
    ).toMatchObject({ code: 'bomb' })
  })

  it('rejects an archive that is not a zip or is cut short', async () => {
    const options = { maxBytes: 1000, store: async () => {} }
    await expect(
      ingestZip(Buffer.from('not a zip at all, really not'), options),
    ).rejects.toMatchObject({
      code: 'invalid',
    })
    const zip = makeZip([{ name: 'a.txt', content: 'hello' }])
    await expect(ingestZip(zip.subarray(0, zip.length - 10), options)).rejects.toMatchObject({
      code: 'invalid',
    })
  })

  it('refuses a corrupted entry (its checksum differs)', async () => {
    const zip = makeZip([{ name: 'a.txt', content: 'hello world', stored: true }])
    const at = zip.indexOf('hello world')
    zip[at] = 0x48
    await expect(ingestZip(zip, { maxBytes: 1000, store: async () => {} })).rejects.toMatchObject({
      code: 'invalid',
    })
  })

  it('stores nothing when any entry of the archive is refused', async () => {
    const stored: string[] = []
    await expect(
      ingestZip(
        makeZip([
          { name: 'index.html', content: 'ok' },
          { name: 'link', type: 'symlink', content: '/etc/passwd' },
        ]),
        { maxBytes: 1000, store: async (f) => void stored.push(f.path) },
      ),
    ).rejects.toMatchObject({ code: 'unsafe-entry' })
    expect(stored).toEqual([])
  })

  it('accepts an archive made on another system (no file type to read)', async () => {
    const { files } = await ingest([{ name: 'index.html', content: 'ok', windows: true }])
    expect(files).toHaveLength(1)
  })
})
