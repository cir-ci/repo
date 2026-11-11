// Microbenchmark: `node packages/diff/scripts/bench.ts`. Diffs generated 1440-wide pages with both
// engines (the comparison alone, then the whole `diffImages` call with PNG decode and encode).
/* oxlint-disable eslint/no-await-in-loop -- a benchmark times one run after another on purpose */
import sharp from 'sharp'

import { comparePixels, nativeEngineStatus } from '../src/engine.ts'
import { diffImages } from '../src/index.ts'

function page(w: number, h: number, changed: boolean): Uint8Array {
  const c = new Uint8Array(w * h * 4)
  let seed = 12345
  const rnd = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296
  for (let y = 0; y < h; y++) {
    const band = (y >> 5) & 1 ? 245 : 232
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4
      let v = band
      // text-like specks and boxes with soft edges
      if ((x * 7 + y * 13) % 97 < 9) v = 40 + ((x + y) % 60)
      if (changed && y % 211 < 40 && x % 300 < 120) v = Math.max(0, v - 70 + Math.floor(rnd() * 5))
      c[o] = v
      c[o + 1] = v
      c[o + 2] = Math.min(255, v + 4)
      c[o + 3] = 255
    }
  }
  return c
}

const median = (xs: number[]) => xs.toSorted((a, b) => a - b)[Math.floor(xs.length / 2)]!

async function time(runs: number, fn: () => Promise<unknown>): Promise<number> {
  await fn()
  const times: number[] = []
  for (let i = 0; i < runs; i++) {
    const t = performance.now()
    await fn()
    times.push(performance.now() - t)
  }
  return median(times)
}

console.log('native:', nativeEngineStatus())
for (const [w, h] of [
  [1440, 900],
  [1440, 4000],
] as const) {
  const a = page(w, h, false)
  const b = page(w, h, true)
  const pngA = await sharp(a, { raw: { width: w, height: h, channels: 4 } })
    .png()
    .toBuffer()
  const pngB = await sharp(b, { raw: { width: w, height: h, channels: 4 } })
    .png()
    .toBuffer()
  for (const engine of ['js', 'native'] as const) {
    const cmp = await time(15, () =>
      comparePixels(engine, a, b, w, h, { threshold: 0.1, alpha: 0.15, withOutput: true }),
    )
    const full = await time(7, () => diffImages(pngA, pngB, { engine }))
    const res = await comparePixels(engine, a, b, w, h, {
      threshold: 0.1,
      alpha: 0.15,
      withOutput: true,
    })
    console.log(
      `${w}x${h} ${engine.padEnd(6)} compare ${cmp.toFixed(1)} ms   diffImages ${full.toFixed(1)} ms   (changed ${res.changedPixels})`,
    )
  }
}
