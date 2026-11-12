import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { UsageError } from '#src/errors.ts'
import { collectScreenshots } from '#src/files.ts'

let root: string
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'circi-cli-files-'))
})
afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

let n = 0
async function fresh(): Promise<string> {
  n += 1
  const dir = join(root, `case-${n}`)
  await mkdir(dir)
  return dir
}

describe('collectScreenshots', () => {
  it('finds PNGs recursively, named by their path, and skips hidden folders', async () => {
    const dir = await fresh()
    await mkdir(join(dir, 'settings'))
    await mkdir(join(dir, '.cache'))
    await writeFile(join(dir, 'home.png'), 'a')
    await writeFile(join(dir, 'settings', 'profile.PNG'), 'b')
    await writeFile(join(dir, '.cache', 'hidden.png'), 'c')
    await writeFile(join(dir, 'notes.txt'), 'd')
    const shots = await collectScreenshots(dir)
    expect(shots.map((s) => s.name)).toEqual(['home', 'settings/profile'])
  })

  it('follows a symlinked file and a symlinked folder, naming them by the link', async () => {
    const dir = await fresh()
    const outside = await fresh()
    await writeFile(join(outside, 'real.png'), 'real')
    await mkdir(join(outside, 'pages'))
    await writeFile(join(outside, 'pages', 'a.png'), 'page a')
    await symlink(join(outside, 'real.png'), join(dir, 'linked-file.png'))
    await symlink(join(outside, 'pages'), join(dir, 'linked-dir'))
    const shots = await collectScreenshots(dir)
    expect(shots.map((s) => s.name)).toEqual(['linked-dir/a', 'linked-file'])
    expect(shots.map((s) => s.size)).toEqual([6, 4])
  })

  it('stops at a link that leads back up the tree instead of looping', async () => {
    const dir = await fresh()
    await mkdir(join(dir, 'a'))
    await writeFile(join(dir, 'a', 'one.png'), '1')
    await symlink(dir, join(dir, 'a', 'loop'))
    await symlink(join(dir, 'a'), join(dir, 'self'))
    const shots = await collectScreenshots(dir)
    // `self` is a second path to `a`, so its file shows up under that name too; `loop` adds nothing.
    expect(shots.map((s) => s.name)).toEqual(['a/one', 'self/one'])
  })

  it('skips a dangling link', async () => {
    const dir = await fresh()
    await writeFile(join(dir, 'ok.png'), 'ok')
    await symlink(join(dir, 'gone.png'), join(dir, 'dangling.png'))
    const shots = await collectScreenshots(dir)
    expect(shots.map((s) => s.name)).toEqual(['ok'])
  })

  it('reads the sidecar metadata', async () => {
    const dir = await fresh()
    await writeFile(join(dir, 'a.png'), 'a')
    await writeFile(join(dir, 'a.png.json'), '{"browser":"chromium"}')
    const [shot] = await collectScreenshots(dir)
    expect(shot?.metadata).toEqual({ browser: 'chromium' })
  })

  it('names a folder that does not exist, and a file that is not a folder', async () => {
    const dir = await fresh()
    await writeFile(join(dir, 'a.png'), 'a')
    await expect(collectScreenshots(join(dir, 'screenshotz'))).rejects.toThrow(
      new UsageError(`No such directory: ${join(dir, 'screenshotz')}`),
    )
    await expect(collectScreenshots(join(dir, 'a.png'))).rejects.toThrow(/is not a directory/)
  })

  it('names a sidecar that is not valid JSON', async () => {
    const dir = await fresh()
    await writeFile(join(dir, 'a.png'), 'a')
    await writeFile(join(dir, 'a.png.json'), '{oops')
    await expect(collectScreenshots(dir)).rejects.toThrow(/a\.png\.json isn't valid JSON/)
    await writeFile(join(dir, 'a.png.json'), '[1]')
    await expect(collectScreenshots(dir)).rejects.toThrow(/must contain a JSON object/)
  })

  it('refuses a PNG over the size limit, naming it', async () => {
    const dir = await fresh()
    await writeFile(join(dir, 'huge.png'), Buffer.alloc(26 * 1024 * 1024))
    await expect(collectScreenshots(dir)).rejects.toThrow(
      /huge\.png is 26\.0 MB; the limit is 25 MB/,
    )
  })

  it('hashes many files with the same result as one by one', async () => {
    const dir = await fresh()
    await Promise.all(
      Array.from({ length: 40 }, (_, i) =>
        writeFile(join(dir, `s${String(i).padStart(2, '0')}.png`), `file ${i}`),
      ),
    )
    const shots = await collectScreenshots(dir)
    expect(shots).toHaveLength(40)
    expect(new Set(shots.map((s) => s.sha256)).size).toBe(40)
    expect(shots.map((s) => s.name)).toEqual(shots.map((s) => s.name).toSorted())
  })
})
