import { writeFileSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import sharp from 'sharp'
import { afterAll, describe, expect, it } from 'vitest'

import { closeDiffPool, comparePixels, configureDiffPool, resolveDiffEngine } from '#src/engine.ts'
import { diffImages } from '#src/index.ts'
import { DiffPool, PoolUnavailableError, defaultThreads, findWorkerScript } from '#src/pool.ts'

/** The `js-workers` engine must give exactly the `js` answers: same count, same diff image bytes. */

function noise(w: number, h: number, seed: number): Uint8Array {
  let a = seed >>> 0
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const c = new Uint8Array(w * h * 4)
  for (let i = 0; i < c.length; i += 1) c[i] = Math.floor(next() * 256)
  return c
}

const same = (x: Uint8Array | undefined, y: Uint8Array | undefined) =>
  Buffer.compare(Buffer.from(x ?? []), Buffer.from(y ?? [])) === 0

const make = (seed: number) =>
  sharp(Buffer.from(noise(48, 32, seed)), { raw: { width: 48, height: 32, channels: 4 } })
    .png()
    .toBuffer()

const warnings: string[] = []
configureDiffPool({ threads: 2, warn: (m) => warnings.push(m) })
afterAll(() => closeDiffPool())

describe('js-workers engine', () => {
  it('finds its worker script and sizes itself from the cores', () => {
    expect(findWorkerScript()).toBeDefined()
    expect(resolveDiffEngine('js-workers')).toBe('js-workers')
    expect(defaultThreads()).toBeGreaterThanOrEqual(1)
  })

  it('matches js: same changed count and the same diff image bytes, with and without output', async () => {
    const cases: [Uint8Array, Uint8Array, number, number, number][] = [
      [noise(40, 30, 1), noise(40, 30, 2), 40, 30, 0.1],
      [noise(64, 64, 3), noise(64, 64, 3), 64, 64, 0.1],
      [noise(17, 9, 4), noise(17, 9, 5), 17, 9, 0],
      [noise(100, 50, 6), noise(100, 50, 7), 100, 50, 0.5],
    ]
    for (const [a, b, w, h, threshold] of cases) {
      const options = { threshold, alpha: 0.15, withOutput: true }
      // oxlint-disable-next-line no-await-in-loop -- sequential on purpose
      const js = await comparePixels('js', a, b, w, h, options)
      // oxlint-disable-next-line no-await-in-loop -- sequential on purpose
      const workers = await comparePixels('js-workers', a, b, w, h, options)
      expect(workers.changedPixels).toBe(js.changedPixels)
      expect(same(workers.output, js.output)).toBe(true)
      // oxlint-disable-next-line no-await-in-loop -- sequential on purpose
      const countOnly = await comparePixels('js-workers', a, b, w, h, {
        threshold,
        withOutput: false,
      })
      expect(countOnly.changedPixels).toBe(js.changedPixels)
      expect(countOnly.output).toBeUndefined()
    }
    expect(warnings).toEqual([])
  })

  it("leaves the caller's buffers intact (inputs are copied, not transferred)", async () => {
    const a = noise(20, 20, 8)
    const b = noise(20, 20, 9)
    const before = Buffer.from(a)
    await comparePixels('js-workers', a, b, 20, 20, { threshold: 0.1, withOutput: true })
    expect(a.byteLength).toBe(20 * 20 * 4)
    expect(same(a, before)).toBe(true)
  })

  it('handles more concurrent comparisons than threads', async () => {
    const jobs = Array.from({ length: 12 }, (_, i) => ({
      a: noise(30, 30, 100 + i),
      b: noise(30, 30, 200 + i),
    }))
    const options = { threshold: 0.1, withOutput: true }
    const [expected, got] = await Promise.all([
      Promise.all(jobs.map((j) => comparePixels('js', j.a, j.b, 30, 30, options))),
      Promise.all(jobs.map((j) => comparePixels('js-workers', j.a, j.b, 30, 30, options))),
    ])
    expect(got.map((r) => r.changedPixels)).toEqual(expected.map((r) => r.changedPixels))
    expect(got.every((r, i) => same(r.output, expected[i]?.output))).toBe(true)
  })

  it('gives diffImages the same result as js for real PNGs, ignore regions included', async () => {
    const [base, head] = await Promise.all([make(11), make(12)])
    const ignore = [{ x: 4, y: 4, width: 10, height: 10 }]
    const js = await diffImages(base, head, { engine: 'js', ignore })
    const workers = await diffImages(base, head, { engine: 'js-workers', ignore })
    expect(workers.changedPixels).toBe(js.changedPixels)
    expect(workers.ignoredChangedPixels).toBe(js.ignoredChangedPixels)
    expect(workers.ignoredRegions).toEqual(js.ignoredRegions)
    expect(same(workers.diffPng, js.diffPng)).toBe(true)
  })
})

describe('js-workers failures', () => {
  it('answers in-thread, with one warning, when the pool is closed under a call', async () => {
    const seen: string[] = []
    await closeDiffPool()
    configureDiffPool({ threads: 1, warn: (m) => seen.push(m) })
    const a = noise(30, 30, 21)
    const b = noise(30, 30, 22)
    const options = { threshold: 0.1, withOutput: true }
    const expected = await comparePixels('js', a, b, 30, 30, options)
    const calls = Promise.all(
      Array.from({ length: 4 }, () => comparePixels('js-workers', a, b, 30, 30, options)),
    )
    await closeDiffPool()
    for (const r of await calls) {
      expect(r.changedPixels).toBe(expected.changedPixels)
      expect(same(r.output, expected.output)).toBe(true)
    }
    expect(seen).toHaveLength(1)
    expect(seen[0]).toMatch(/comparing in-thread/)
  })

  it('stops using a pool whose threads keep crashing: warns once, rejects with PoolUnavailableError', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'circi-pool-'))
    const script = join(dir, 'crash.mjs')
    writeFileSync(script, "throw new Error('boom')\n")
    const seen: string[] = []
    const pool = new DiffPool(1, pathToFileURL(script), (m) => seen.push(m))
    const a = noise(8, 8, 1)
    const call = () =>
      pool
        .compare({ a, b: a, width: 8, height: 8, threshold: 0.1, alpha: 0.1, withOutput: false })
        .catch((err: unknown) => err)
    for (let i = 0; i < 8; i += 1) {
      // oxlint-disable-next-line no-await-in-loop -- each call waits for the previous crash
      expect(await call()).toBeInstanceOf(PoolUnavailableError)
    }
    expect(seen).toHaveLength(1)
    expect(seen[0]).toMatch(/pool is off/)
    await pool.close()
  })

  it('fails with PoolUnavailableError when there is no worker script', async () => {
    const pool = new DiffPool(1, undefined, () => {})
    const a = noise(8, 8, 1)
    await expect(
      pool.compare({ a, b: a, width: 8, height: 8, threshold: 0.1, alpha: 0.1, withOutput: false }),
    ).rejects.toBeInstanceOf(PoolUnavailableError)
  })
})
