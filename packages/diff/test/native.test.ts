import sharp from 'sharp'
import { describe, expect, it } from 'vitest'

import { comparePixels, nativeEngineStatus, resolveDiffEngine } from '#src/engine.ts'
import { diffImages } from '#src/index.ts'

/**
 * The Rust engine must give pixelmatch's answers: the same changed-pixel count and a
 * byte-identical diff image, for every pair here. The suite skips when the addon isn't built (a
 * machine without Rust: `pnpm --filter @circi/diff build` makes it).
 */
const available = nativeEngineStatus().available

/** A small seeded generator, so every run draws the same images. */
function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

type Canvas = Uint8Array

function solid(w: number, h: number, rgba: [number, number, number, number]): Canvas {
  const c = new Uint8Array(w * h * 4)
  for (let i = 0; i < w * h; i++) c.set(rgba, i * 4)
  return c
}

function noise(w: number, h: number, seed: number, alpha = false): Canvas {
  const r = rng(seed)
  const c = new Uint8Array(w * h * 4)
  for (let i = 0; i < w * h; i++) {
    c[i * 4] = Math.floor(r() * 256)
    c[i * 4 + 1] = Math.floor(r() * 256)
    c[i * 4 + 2] = Math.floor(r() * 256)
    c[i * 4 + 3] = alpha ? Math.floor(r() * 256) : 255
  }
  return c
}

function rect(c: Canvas, w: number, x: number, y: number, rw: number, rh: number, v: number[]) {
  const h = c.length / 4 / w
  for (let j = y; j < Math.min(h, y + rh); j++)
    for (let i = x; i < Math.min(w, x + rw); i++) c.set(v, (j * w + i) * 4)
}

/** A page-like canvas: background, boxes, and smooth (anti-aliased) disc and diagonal edges. */
function page(w: number, h: number, shift: number, seed: number): Canvas {
  const r = rng(seed)
  const c = solid(w, h, [250, 250, 252, 255])
  for (let k = 0; k < 12; k++) {
    rect(
      c,
      w,
      Math.floor(r() * (w - 10)),
      Math.floor(r() * (h - 10)),
      5 + Math.floor(r() * 30),
      4 + Math.floor(r() * 20),
      [Math.floor(r() * 256), Math.floor(r() * 256), Math.floor(r() * 256), 255],
    )
  }
  // Smooth disc: coverage-weighted edge pixels are what the AA detector looks at.
  const cx = w / 2 + shift
  const cy = h / 2 + shift * 0.5
  const rad = Math.min(w, h) / 3
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const cover = Math.min(1, Math.max(0, rad - Math.hypot(x - cx, y - cy) + 0.5))
      if (cover > 0) {
        const o = (y * w + x) * 4
        for (let ch = 0; ch < 3; ch++)
          c[o + ch] = Math.round(c[o + ch]! * (1 - cover) + [20, 40, 160][ch]! * cover)
      }
    }
  }
  return c
}

/** Nudges `fraction` of the pixels by up to `amount` per channel. */
function perturb(
  src: Canvas,
  seed: number,
  fraction: number,
  amount: number,
  alpha = false,
): Canvas {
  const r = rng(seed)
  const c = src.slice()
  for (let i = 0; i < c.length / 4; i++) {
    if (r() >= fraction) continue
    for (let ch = 0; ch < (alpha ? 4 : 3); ch++) {
      const d = Math.round((r() * 2 - 1) * amount)
      c[i * 4 + ch] = Math.min(255, Math.max(0, c[i * 4 + ch]! + d))
    }
  }
  return c
}

type Case = [a: Canvas, b: Canvas, w: number, h: number, threshold: number]

/** Runs every case on both engines; returns what differs (empty when the engines agree exactly). */
async function mismatches(cases: Case[]): Promise<string[]> {
  const out = await Promise.all(
    cases.map(async ([a, b, w, h, threshold], n) => {
      const opts = { threshold, alpha: 0.15, withOutput: true }
      const js = await comparePixels('js', a, b, w, h, opts)
      const native = await comparePixels('native', a, b, w, h, opts)
      const countOnly = await comparePixels('native', a, b, w, h, { threshold, withOutput: false })
      const problems: string[] = []
      if (native.changedPixels !== js.changedPixels)
        problems.push(`count ${native.changedPixels} != ${js.changedPixels}`)
      if (countOnly.changedPixels !== js.changedPixels) problems.push('count-only differs')
      if (countOnly.output !== undefined) problems.push('count-only drew an image')
      if (Buffer.compare(Buffer.from(native.output ?? []), Buffer.from(js.output ?? [])) !== 0)
        problems.push('diff image differs')
      return problems.length > 0
        ? `case ${n} (${w}x${h}, threshold ${threshold}): ${problems.join(', ')}`
        : ''
    }),
  )
  return out.filter((m) => m !== '')
}

const THRESHOLDS = [0, 0.02, 0.1, 0.25, 0.5, 1]

const summary = (r: diffImages.Result) => ({
  changedPixels: r.changedPixels,
  ignoredChangedPixels: r.ignoredChangedPixels,
  ignoredRegions: r.ignoredRegions,
  changed: r.changed,
  score: r.score,
  sizeChanged: r.sizeChanged,
  diffPng: r.diffPng?.toString('base64') ?? null,
})

describe.skipIf(!available)('native engine equals pixelmatch', () => {
  it('identical images: zero changed, same gray rendering', async () => {
    const a = page(120, 80, 0, 1)
    const cases = THRESHOLDS.map((t): Case => [a, a.slice(), 120, 80, t])
    expect(await mismatches(cases)).toEqual([])
    const r = await comparePixels('native', a, a, 120, 80, { threshold: 0.1, withOutput: false })
    expect(r.changedPixels).toBe(0)
  })

  it('a small changed rectangle', async () => {
    const a = solid(200, 150, [255, 255, 255, 255])
    const b = a.slice()
    rect(b, 200, 40, 30, 17, 9, [0, 90, 200, 255])
    expect(await mismatches(THRESHOLDS.map((t): Case => [a, b, 200, 150, t]))).toEqual([])
    const r = await comparePixels('native', a, b, 200, 150, { threshold: 0.1, withOutput: false })
    expect(r.changedPixels).toBe(17 * 9)
  })

  it('large changes: unrelated noise', async () => {
    const a = noise(160, 120, 11)
    const b = noise(160, 120, 12)
    expect(await mismatches(THRESHOLDS.map((t): Case => [a, b, 160, 120, t]))).toEqual([])
  })

  it('anti-aliased edges: a disc moved by sub-pixel to few pixels', async () => {
    const base = page(180, 140, 0, 7)
    const cases: Case[] = []
    for (const shift of [0.2, 0.5, 1, 1.5, 3]) {
      for (const t of [0, 0.05, 0.1, 0.3]) cases.push([base, page(180, 140, shift, 7), 180, 140, t])
    }
    expect(await mismatches(cases)).toEqual([])
  })

  it('threshold boundary: small per-channel nudges on a third of the pixels', async () => {
    const a = noise(150, 100, 21)
    const cases: Case[] = []
    for (const amount of [1, 2, 4, 8, 16, 40]) {
      const b = perturb(a, 22 + amount, 0.33, amount)
      for (const t of [0.005, 0.01, 0.02, 0.05, 0.1, 0.2]) cases.push([a, b, 150, 100, t])
    }
    expect(await mismatches(cases)).toEqual([])
  })

  it('smooth gradients nudged by one level', async () => {
    const w = 256
    const h = 40
    const a = new Uint8Array(w * h * 4)
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) a.set([x, x, x, 255], (y * w + x) * 4)
    const b = perturb(a, 31, 1, 1)
    expect(
      await mismatches([0, 0.001, 0.003, 0.01, 0.1].map((t): Case => [a, b, w, h, t])),
    ).toEqual([])
  })

  it('transparency: random alpha on both sides, and alpha-only differences', async () => {
    const a = noise(140, 90, 41, true)
    const cases: Case[] = []
    for (const t of THRESHOLDS) {
      cases.push([a, noise(140, 90, 42, true), 140, 90, t])
      cases.push([a, perturb(a, 43, 0.4, 30, true), 140, 90, t])
      cases.push([solid(60, 60, [0, 0, 0, 0]), solid(60, 60, [0, 0, 0, 10]), 60, 60, t])
      cases.push([solid(60, 60, [0, 0, 0, 0]), solid(60, 60, [255, 0, 0, 0]), 60, 60, t])
    }
    expect(await mismatches(cases)).toEqual([])
  })

  it('padding: opaque content against a transparent canvas', async () => {
    const a = page(100, 70, 0, 5)
    const b = a.slice()
    for (let y = 40; y < 70; y++) b.fill(0, y * 100 * 4, (y + 1) * 100 * 4)
    expect(await mismatches([0, 0.1, 0.5].map((t): Case => [a, b, 100, 70, t]))).toEqual([])
  })

  it('tiny and thin images (edges of the neighbourhood code)', async () => {
    const cases: Case[] = []
    for (const [w, h] of [
      [1, 1],
      [1, 9],
      [9, 1],
      [2, 2],
      [3, 3],
      [2, 17],
      [31, 2],
    ] as const) {
      for (let seed = 0; seed < 6; seed++) {
        const a = noise(w, h, 100 + seed)
        for (const t of [0, 0.1, 0.4]) {
          cases.push([a, noise(w, h, 200 + seed), w, h, t])
          cases.push([a, perturb(a, 300 + seed, 0.5, 20), w, h, t])
        }
      }
    }
    expect(await mismatches(cases)).toEqual([])
  })

  it('many random pairs mixing all of the above', async () => {
    const r = rng(999)
    const cases: Case[] = []
    for (let n = 0; n < 60; n++) {
      const w = 20 + Math.floor(r() * 80)
      const h = 20 + Math.floor(r() * 80)
      const alpha = r() < 0.4
      const base = r() < 0.5 ? noise(w, h, n, alpha) : page(w, h, 0, n)
      const head = perturb(base, n + 2000, r(), Math.floor(r() * 60), alpha)
      cases.push([base, head, w, h, [0, 0.03, 0.1, 0.3][n % 4]!])
    }
    expect(await mismatches(cases)).toEqual([])
  })

  it('refuses buffers that do not match the size', async () => {
    await expect(
      comparePixels('native', new Uint8Array(16), new Uint8Array(16), 3, 3, {
        threshold: 0.1,
        withOutput: false,
      }),
    ).rejects.toThrow(/size does not match/)
  })

  it('diffImages gives the same result with either engine (PNGs, size change, ignore regions)', async () => {
    const w = 320
    const h = 240
    const base = page(w, h, 0, 3)
    const head = page(w, h, 1.5, 3)
    const toPng = (raw: Canvas, rw = w, rh = h) =>
      sharp(raw, { raw: { width: rw, height: rh, channels: 4 } })
        .png()
        .toBuffer()
    const [pngBase, pngHead, pngShort] = await Promise.all([
      toPng(base),
      toPng(head),
      toPng(head.subarray(0, 320 * 200 * 4), 320, 200),
    ])
    const cases: Array<[Buffer, Buffer, diffImages.Options]> = [
      [pngBase, pngHead, {}],
      [pngBase, pngHead, { threshold: 0.01, ignore: [{ x: 60, y: 40, width: 120, height: 90 }] }],
      [pngBase, pngShort, { pixelTolerance: 0.05 }],
      [pngBase, pngBase, {}],
    ]
    const results = await Promise.all(
      cases.map(async ([x, y, options]) => ({
        js: await diffImages(x, y, { ...options, engine: 'js' }),
        native: await diffImages(x, y, { ...options, engine: 'native' }),
      })),
    )
    expect(results.map((r) => summary(r.native))).toEqual(results.map((r) => summary(r.js)))
    expect(results[0]?.js.changedPixels).toBeGreaterThan(0)
  })
})

describe('engine selection', () => {
  it('js stays js', () => {
    expect(resolveDiffEngine('js')).toBe('js')
  })

  it.skipIf(!available)('native resolves to native when the addon loads, without a warning', () => {
    const warnings: string[] = []
    expect(resolveDiffEngine('native', (m) => warnings.push(m))).toBe('native')
    expect(warnings).toEqual([])
  })

  it.skipIf(available)('native falls back to js with one warning when the addon is missing', () => {
    const warnings: string[] = []
    expect(resolveDiffEngine('native', (m) => warnings.push(m))).toBe('js')
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('CIRCI_DIFF_ENGINE=native')
  })

  it('asking for native without the addon still compares (falls back per call)', async () => {
    const a = solid(4, 4, [255, 255, 255, 255])
    const b = solid(4, 4, [0, 0, 0, 255])
    const r = await comparePixels('native', a, b, 4, 4, { threshold: 0.1, withOutput: false })
    expect(r.changedPixels).toBe(16)
  })
})
