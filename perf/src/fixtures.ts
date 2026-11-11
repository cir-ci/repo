/* oxlint-disable no-await-in-loop -- one image at a time keeps memory flat */
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import sharp from 'sharp'

import { FIXTURES_DIR, MANIFEST_FILE } from './config.ts'

/**
 * PNG fixtures for the upload scenario and the diff benchmark: synthetic web pages (header,
 * sidebar, cards of text-like lines, photo-like noisy hero blocks), generated from a seed so every
 * machine gets the same bytes. Run `pnpm perf:fixtures [--force] [--variants N] [--seed N]`.
 */

export type ShotKind = 'unchanged' | 'reencoded' | 'small' | 'large' | 'added'

export interface FixtureFile {
  /** Relative to `perf/fixtures`. */
  file: string
  sha256: string
  size: number
}

export interface Shot {
  name: string
  kind: ShotKind
  width: number
  height: number
  /** The baseline's file (absent for an added screenshot). */
  baseline?: FixtureFile
  /** What a build uploads: one file, or one per variant so concurrent builds never share bytes. */
  variants: FixtureFile[]
}

export interface Manifest {
  seed: number
  variantCount: number
  shots: Shot[]
  /** Pairs the benchmark runs besides the shots (a size change). */
  extras: { name: string; base: FixtureFile; head: FixtureFile; width: number; height: number }[]
  /** Same-name pairs with different bytes in one build: the ones the worker pixel-diffs. */
  diffedPerBuild: number
}

const VIEWPORT = { width: 1440, height: 900 }
const FULL_PAGE = { width: 1440, height: 4000 }

/** The ten screenshots of one build, in order. */
const LAYOUT: { name: string; full: boolean; kind: ShotKind }[] = [
  { name: 'home', full: false, kind: 'unchanged' },
  { name: 'pricing', full: false, kind: 'unchanged' },
  { name: 'docs', full: false, kind: 'reencoded' },
  { name: 'landing-full', full: true, kind: 'reencoded' },
  { name: 'dashboard', full: false, kind: 'small' },
  { name: 'article-full', full: true, kind: 'small' },
  { name: 'settings', full: false, kind: 'large' },
  { name: 'catalog-full', full: true, kind: 'large' },
  { name: 'signup', full: false, kind: 'added' },
  { name: 'changelog-full', full: true, kind: 'added' },
]

type Rgb = readonly [number, number, number]

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

const hashSeed = (...parts: (string | number)[]): number =>
  createHash('sha256').update(parts.join('/')).digest().readUInt32LE(0)

class Canvas {
  readonly width: number
  readonly height: number
  readonly data: Buffer
  constructor(width: number, height: number, data?: Buffer) {
    this.width = width
    this.height = height
    this.data = data ?? Buffer.alloc(width * height * 3)
  }

  clone(): Canvas {
    return new Canvas(this.width, this.height, Buffer.from(this.data))
  }

  rect(x: number, y: number, w: number, h: number, [r, g, b]: Rgb): void {
    const x0 = Math.max(0, x)
    const x1 = Math.min(this.width, x + w)
    for (let yy = Math.max(0, y); yy < Math.min(this.height, y + h); yy += 1) {
      for (let xx = x0; xx < x1; xx += 1) {
        const i = (yy * this.width + xx) * 3
        this.data[i] = r
        this.data[i + 1] = g
        this.data[i + 2] = b
      }
    }
  }

  /** A diagonal gradient with per-pixel noise: compresses like a photograph, not like a flat colour. */
  photo(x: number, y: number, w: number, h: number, from: Rgb, to: Rgb, rand: () => number): void {
    for (let yy = Math.max(0, y); yy < Math.min(this.height, y + h); yy += 1) {
      for (let xx = Math.max(0, x); xx < Math.min(this.width, x + w); xx += 1) {
        const t = ((xx - x) / w + (yy - y) / h) / 2
        const noise = (rand() - 0.5) * 24
        const i = (yy * this.width + xx) * 3
        for (let c = 0; c < 3; c += 1) {
          const v = (from[c] ?? 0) + ((to[c] ?? 0) - (from[c] ?? 0)) * t + noise
          this.data[i + c] = Math.max(0, Math.min(255, Math.round(v)))
        }
      }
    }
  }

  /** Moves everything from row `fromY` down by `by` rows (a layout shift); the gap is page colour. */
  shiftDown(fromY: number, by: number): void {
    this.data.copyWithin((fromY + by) * this.width * 3, fromY * this.width * 3)
    this.rect(0, fromY, this.width, by, PAGE)
  }
}

const PAGE: Rgb = [246, 247, 249]
const INK: Rgb = [51, 56, 66]
const MUTED: Rgb = [176, 182, 192]

function renderPage(seed: number, width: number, height: number): Canvas {
  const rand = rng(seed)
  const c = new Canvas(width, height)
  c.rect(0, 0, width, height, PAGE)
  c.rect(0, 0, width, 64, [24, 28, 38])
  c.rect(24, 20, 120, 24, [92, 124, 250])
  for (let i = 0; i < 5; i += 1) c.rect(width - 520 + i * 96, 26, 72, 12, MUTED)
  c.rect(0, 64, 240, height - 64, [236, 238, 242])
  for (let i = 0; i < 14; i += 1) c.rect(24, 96 + i * 36, 120 + Math.floor(rand() * 80), 12, MUTED)

  let y = 96
  while (y < height - 160) {
    c.rect(280, y, width - 320, 4, [226, 229, 235])
    c.rect(280, y + 28, 360 + Math.floor(rand() * 400), 22, INK)
    if (rand() < 0.5) {
      const h = 220 + Math.floor(rand() * 160)
      c.photo(
        280,
        y + 70,
        width - 320,
        h,
        [Math.floor(rand() * 200), Math.floor(rand() * 200), Math.floor(rand() * 200)],
        [Math.floor(rand() * 255), Math.floor(rand() * 255), Math.floor(rand() * 255)],
        rand,
      )
      y += h + 100
    } else {
      const lines = 6 + Math.floor(rand() * 6)
      for (let i = 0; i < lines; i += 1) {
        c.rect(280, y + 70 + i * 24, 300 + Math.floor(rand() * (width - 700)), 10, MUTED)
      }
      c.rect(280, y + 90 + lines * 24, 160, 40, [92, 124, 250])
      y += 150 + lines * 24
    }
  }
  return c
}

/** A few small edits: a button recoloured, some lines moved, a badge. Under 1% of the pixels. */
function smallChange(base: Canvas, seed: number): Canvas {
  const rand = rng(seed)
  const c = base.clone()
  for (let i = 0; i < 3; i += 1) {
    const x = 280 + Math.floor(rand() * (c.width - 700))
    const y = 100 + Math.floor(rand() * (c.height - 300))
    c.rect(x, y, 140 + Math.floor(rand() * 60), 36, [
      Math.floor(rand() * 255),
      Math.floor(rand() * 255),
      Math.floor(rand() * 255),
    ])
  }
  c.rect(c.width - 120, 10, 60, 44, [Math.floor(rand() * 255), 80, Math.floor(rand() * 255)])
  return c
}

/**
 * A big change. A viewport screenshot gets its whole content area replaced by a different
 * picture (about three quarters of the pixels); a full page has a banner inserted that shifts
 * everything below it.
 */
function largeChange(base: Canvas, seed: number, full: boolean): Canvas {
  const rand = rng(seed)
  const c = base.clone()
  if (full) {
    c.shiftDown(300, 120 + Math.floor(rand() * 80))
    c.photo(
      280,
      320,
      c.width - 320,
      100,
      [Math.floor(rand() * 255), 40, 60],
      [40, Math.floor(rand() * 255), 200],
      rand,
    )
  } else {
    c.photo(
      240,
      64,
      c.width - 240,
      c.height - 64,
      [Math.floor(rand() * 255), Math.floor(rand() * 255), 30],
      [30, Math.floor(rand() * 255), Math.floor(rand() * 255)],
      rand,
    )
  }
  return c
}

const encode = (c: Canvas, level = 6) =>
  sharp(c.data, { raw: { width: c.width, height: c.height, channels: 3 } })
    .png({ compressionLevel: level })
    .toBuffer()

async function save(relative: string, bytes: Buffer): Promise<FixtureFile> {
  const path = join(FIXTURES_DIR, relative)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, bytes)
  return {
    file: relative,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    size: bytes.length,
  }
}

export async function generateFixtures(options: {
  seed?: number
  variants?: number
  log?: (line: string) => void
}): Promise<Manifest> {
  const seed = options.seed ?? 1
  const variantCount = options.variants ?? 24
  const log = options.log ?? (() => undefined)
  await rm(FIXTURES_DIR, { recursive: true, force: true })
  await mkdir(FIXTURES_DIR, { recursive: true })

  const shots: Shot[] = []
  const seen = new Set<string>()
  const unique = (f: FixtureFile): FixtureFile => {
    if (seen.has(f.sha256)) throw new Error(`Two fixtures have the same bytes: ${f.file}`)
    seen.add(f.sha256)
    return f
  }
  let extras: Manifest['extras'] = []

  for (const item of LAYOUT) {
    const size = item.full ? FULL_PAGE : VIEWPORT
    const base = renderPage(hashSeed(seed, item.name), size.width, size.height)
    const shot: Shot = { name: item.name, kind: item.kind, ...size, variants: [] }
    if (item.kind !== 'added') {
      shot.baseline = unique(await save(`baseline/${item.name}.png`, await encode(base)))
    }
    if (item.kind === 'unchanged' && shot.baseline) shot.variants = [shot.baseline]
    if (item.kind === 'reencoded') {
      // The same pixels, other bytes: the worker has to decode and compare them to find out.
      shot.variants = [
        unique(await save(`variants/${item.name}/reencoded.png`, await encode(base, 1))),
      ]
    }
    for (let v = 0; v < variantCount && ['small', 'large', 'added'].includes(item.kind); v += 1) {
      const vSeed = hashSeed(seed, item.name, item.kind, v)
      let canvas: Canvas
      if (item.kind === 'small') canvas = smallChange(base, vSeed)
      else if (item.kind === 'large') canvas = largeChange(base, vSeed, item.full)
      else canvas = renderPage(vSeed, size.width, size.height)
      shot.variants.push(
        unique(await save(`variants/${item.name}/${item.kind}-${v}.png`, await encode(canvas))),
      )
    }
    if (item.name === 'article-full' && shot.baseline) {
      // A taller page than its baseline: the size-change path of the comparison.
      const taller = renderPage(hashSeed(seed, item.name), size.width, size.height + 200)
      extras = [
        {
          name: 'article-full-taller',
          base: shot.baseline,
          head: unique(await save('extras/article-full-taller.png', await encode(taller))),
          width: size.width,
          height: size.height + 200,
        },
      ]
    }
    log(`${item.name}: ${item.kind}, ${shot.variants.length} file(s)`)
    shots.push(shot)
  }

  const manifest: Manifest = {
    seed,
    variantCount,
    shots,
    extras,
    diffedPerBuild: shots.filter((s) => ['reencoded', 'small', 'large'].includes(s.kind)).length,
  }
  await writeFile(MANIFEST_FILE, `${JSON.stringify(manifest, null, 2)}\n`)
  return manifest
}

/**
 * The manifest with `count` screenshots per build: the generated ones repeated under new names
 * (`home`, …, then `home-1`, …), each copy reusing its original's files. The server diffs every
 * screenshot by name, so the diff work is real; it stores files by hash, so a repeated file is
 * uploaded once per build, and "uploaded MB" understates what distinct screenshots would send.
 */
export function withShots(manifest: Manifest, count: number): Manifest {
  if (count === manifest.shots.length) return manifest
  const base = manifest.shots
  const shots: Shot[] = Array.from({ length: count }, (_, i) => {
    const original = base[i % base.length]!
    const copy = Math.floor(i / base.length)
    return { ...original, name: copy === 0 ? original.name : `${original.name}-${copy}` }
  })
  return {
    ...manifest,
    shots,
    diffedPerBuild: shots.filter((s) => ['reencoded', 'small', 'large'].includes(s.kind)).length,
  }
}

export async function readManifest(): Promise<Manifest> {
  // The file is written by generateFixtures above.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return JSON.parse(await readFile(MANIFEST_FILE, 'utf8')) as Manifest
}

export async function ensureFixtures(log: (line: string) => void): Promise<Manifest> {
  if (existsSync(MANIFEST_FILE)) return readManifest()
  log('Generating fixtures (once; perf/fixtures is gitignored)')
  return generateFixtures({ log })
}

if (import.meta.main) {
  const args = process.argv.slice(2)
  const value = (flag: string) => {
    const at = args.indexOf(flag)
    return at >= 0 ? Number(args[at + 1]) : undefined
  }
  if (!args.includes('--force') && existsSync(MANIFEST_FILE)) {
    console.log(`Fixtures exist (${MANIFEST_FILE}); pass --force to regenerate.`)
  } else {
    const started = Date.now()
    const seed = value('--seed')
    const variants = value('--variants')
    const manifest = await generateFixtures({
      ...(seed === undefined ? {} : { seed }),
      ...(variants === undefined ? {} : { variants }),
      log: console.log,
    })
    console.log(
      `Done in ${Math.round((Date.now() - started) / 1000)}s: ${manifest.shots.length} screenshots per build, ${manifest.variantCount} variants.`,
    )
  }
}
