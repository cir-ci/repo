import sharp, { type Metadata } from 'sharp'

import { comparePixels, type DiffEngine } from '#src/engine.ts'

export {
  closeDiffPool,
  configureDiffPool,
  type DiffEngine,
  nativeEngineStatus,
  resolveDiffEngine,
} from '#src/engine.ts'

/**
 * Image work for the worker (PLAN §7.3): validate screenshots, diff two of them, and make
 * thumbnails. Pure functions over buffers so they're easy to test with generated images.
 */

/** Refuse decompression bombs: 100 megapixels is far beyond any real screenshot. */
const MAX_INPUT_PIXELS = 100_000_000

export class InvalidImageError extends Error {
  /** What was wrong, in plain words for a person ("not a PNG", "the file is truncated"). */
  readonly reason: string
  constructor(message: string, reason = message) {
    super(message)
    this.name = 'InvalidImageError'
    this.reason = reason
  }
}

/** Plain words for what a decoder (sharp) complained about. */
function plainReason(raw: string): string {
  const text = raw.toLowerCase()
  if (text.includes('empty')) return 'the file is empty'
  if (text.includes('unsupported image format')) return 'not a PNG'
  if (
    text.includes('corrupt') ||
    text.includes('read error') ||
    text.includes('premature') ||
    text.includes('treated as error') // sharp's wording for a stream that ends early
  ) {
    return 'the file is corrupt or truncated'
  }
  return `the file can't be decoded (${raw})`
}

/** An `InvalidImageError` for whatever the decoder threw. */
function unreadable(err: unknown): InvalidImageError {
  const raw = err instanceof Error ? err.message : String(err)
  return new InvalidImageError(`Not a readable image: ${raw}`, plainReason(raw))
}

export namespace readPngInfo {
  export interface Info {
    width: number
    height: number
  }
}

/** Checks the bytes really are a PNG (whatever the client claimed) and reads its size. */
export async function readPngInfo(png: Buffer): Promise<readPngInfo.Info> {
  let meta: Metadata
  try {
    meta = await sharp(png, { limitInputPixels: MAX_INPUT_PIXELS }).metadata()
  } catch (err) {
    throw unreadable(err)
  }
  if (meta.format !== 'png') {
    throw new InvalidImageError(
      `Expected a PNG, got ${meta.format ?? 'unknown'}`,
      `not a PNG (it's ${meta.format ? `a ${meta.format.toUpperCase()} file` : 'another kind of file'})`,
    )
  }
  if (!meta.width || !meta.height) {
    throw new InvalidImageError('PNG has no dimensions', 'the PNG has no dimensions')
  }
  return { width: meta.width, height: meta.height }
}

export namespace diffImages {
  export interface Options {
    /**
     * Per-pixel colour tolerance passed to pixelmatch (0–1, perceptual distance). The default
     * 0.1 ignores imperceptible noise. This is not the project's diff threshold, which applies
     * to the share of changed pixels.
     */
    pixelTolerance?: number
    /** Project diff threshold: share of changed pixels (0–1) still considered unchanged. */
    threshold?: number
    /** Rectangles (in pixels) that are blanked in both images first: clocks, ads, avatars… */
    ignore?: readonly diffImages.IgnoreRegion[]
    /**
     * Which pixel comparison runs (default `js`). `native` uses the Rust addon when it loads and
     * the JS one otherwise; `js-workers` runs pixelmatch in a worker-thread pool (in-thread on
     * failure); use `resolveDiffEngine` once at startup to learn which and to warn.
     */
    engine?: DiffEngine
  }

  export interface Result {
    base: readPngInfo.Info
    head: readPngInfo.Info
    /** Canvas the comparison ran on: the larger of both sizes. */
    width: number
    height: number
    sizeChanged: boolean
    changedPixels: number
    /** changedPixels / (width × height). */
    score: number
    /** `changed` whenever the size differs, otherwise when score > threshold (PLAN §7.3). */
    changed: boolean
    /** Diff visualisation (PNG); only produced when `changed`. */
    diffPng?: Buffer
    /**
     * Pixels that differ inside the ignored rectangles (what the mask hid), counted with the
     * same tolerance; 0 without regions.
     */
    ignoredChangedPixels: number
    /** Indexes (into `options.ignore`) of the rectangles that hid at least one differing pixel. */
    ignoredRegions: number[]
  }

  export interface IgnoreRegion {
    x: number
    y: number
    width: number
    height: number
  }
}

/** Makes the region identical (transparent) in a canvas, clipped to its edges. */
function blank(
  raw: Uint8Array,
  canvasWidth: number,
  canvasHeight: number,
  r: diffImages.IgnoreRegion,
): void {
  const x0 = Math.max(0, Math.floor(r.x))
  const y0 = Math.max(0, Math.floor(r.y))
  const x1 = Math.min(canvasWidth, Math.floor(r.x + r.width))
  const y1 = Math.min(canvasHeight, Math.floor(r.y + r.height))
  for (let y = y0; y < y1; y += 1) {
    raw.fill(0, (y * canvasWidth + x0) * 4, (y * canvasWidth + x1) * 4)
  }
}

/** Copies a region (clipped to the canvas) out of a canvas into its own RGBA buffer. */
function crop(
  raw: Uint8Array,
  canvasWidth: number,
  canvasHeight: number,
  r: diffImages.IgnoreRegion,
): { data: Uint8Array; width: number; height: number } {
  const x0 = Math.max(0, Math.floor(r.x))
  const y0 = Math.max(0, Math.floor(r.y))
  const x1 = Math.min(canvasWidth, Math.floor(r.x + r.width))
  const y1 = Math.min(canvasHeight, Math.floor(r.y + r.height))
  const width = Math.max(0, x1 - x0)
  const height = Math.max(0, y1 - y0)
  const data = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y += 1) {
    data.set(
      raw.subarray(((y0 + y) * canvasWidth + x0) * 4, ((y0 + y) * canvasWidth + x1) * 4),
      y * width * 4,
    )
  }
  return { data, width, height }
}

export async function diffImages(
  basePng: Buffer,
  headPng: Buffer,
  options: diffImages.Options = {},
): Promise<diffImages.Result> {
  const [base, head] = await Promise.all([readPngInfo(basePng), readPngInfo(headPng)])
  const width = Math.max(base.width, head.width)
  const height = Math.max(base.height, head.height)
  const sizeChanged = base.width !== head.width || base.height !== head.height

  // Pad both onto the same canvas with transparency so pixelmatch can compare them. Padding
  // only exists to draw the diff; a size change is a change regardless of the score.
  const [baseRaw, headRaw] = await Promise.all([
    toRgbaCanvas(basePng, base, width, height),
    toRgbaCanvas(headPng, head, width, height),
  ])
  // What the mask is about to hide: a second pass over the rectangles only, not a full diff.
  const tolerance = options.pixelTolerance ?? 0.1
  const engine = options.engine ?? 'js'
  const hiddenPerRegion = await Promise.all(
    (options.ignore ?? []).map(async (region) => {
      const a = crop(baseRaw, width, height, region)
      const b = crop(headRaw, width, height, region)
      if (a.width === 0 || a.height === 0) return 0
      const { changedPixels } = await comparePixels(engine, a.data, b.data, a.width, a.height, {
        threshold: tolerance,
        withOutput: false,
      })
      return changedPixels
    }),
  )
  const ignoredRegions = hiddenPerRegion.flatMap((hidden, index) => (hidden > 0 ? [index] : []))
  const ignoredChangedPixels = hiddenPerRegion.reduce((sum, hidden) => sum + hidden, 0)
  for (const region of options.ignore ?? []) {
    blank(baseRaw, width, height, region)
    blank(headRaw, width, height, region)
  }
  const { changedPixels, output } = await comparePixels(engine, baseRaw, headRaw, width, height, {
    threshold: tolerance,
    alpha: 0.15,
    withOutput: true,
  })
  const score = changedPixels / (width * height)
  const changed = sizeChanged || score > (options.threshold ?? 0)

  const result: diffImages.Result = {
    base,
    head,
    width,
    height,
    sizeChanged,
    changedPixels,
    score,
    changed,
    ignoredChangedPixels,
    ignoredRegions,
  }
  if (changed && output) {
    result.diffPng = await sharp(output, { raw: { width, height, channels: 4 } })
      .png({ compressionLevel: 9 })
      .toBuffer()
  }
  return result
}

async function toRgbaCanvas(
  png: Buffer,
  info: readPngInfo.Info,
  width: number,
  height: number,
): Promise<Uint8Array> {
  let data: Buffer
  try {
    data = await sharp(png, { limitInputPixels: MAX_INPUT_PIXELS })
      .ensureAlpha()
      .extend({
        right: width - info.width,
        bottom: height - info.height,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .raw()
      .toBuffer()
  } catch (err) {
    throw unreadable(err)
  }
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
}

export namespace makeThumbnail {
  export interface Result {
    webp: Buffer
    width: number
    height: number
  }
}

const THUMB_WIDTH = 480
const THUMB_MAX_HEIGHT = 720

/** List thumbnail: the top of the screenshot, at most 480×720, as WebP. */
export async function makeThumbnail(png: Buffer): Promise<makeThumbnail.Result> {
  const info = await readPngInfo(png)
  const scale = Math.min(1, THUMB_WIDTH / info.width)
  const scaledHeight = Math.max(1, Math.round(info.height * scale))
  try {
    const { data, info: out } = await sharp(png, { limitInputPixels: MAX_INPUT_PIXELS })
      .resize({ width: Math.min(THUMB_WIDTH, info.width), withoutEnlargement: true })
      .extract({
        left: 0,
        top: 0,
        width: Math.min(THUMB_WIDTH, info.width),
        height: Math.min(THUMB_MAX_HEIGHT, scaledHeight),
      })
      .webp({ quality: 80 })
      .toBuffer({ resolveWithObject: true })
    return { webp: data, width: out.width, height: out.height }
  } catch (err) {
    // The header read fine but the pixel data didn't (a truncated file).
    throw unreadable(err)
  }
}

export namespace makeWorkspacePicture {
  export interface Result {
    /** A PNG, `size` pixels square. */
    png: Buffer
    /** What the upload was (`png`, `jpeg` or `webp`). */
    format: string
  }
}

/**
 * A workspace's picture from an upload: checks the bytes really are a PNG, JPEG or WebP (whatever
 * the client claimed), crops to the centre square and resizes to `size` pixels. Transparency is
 * kept; the result is always a PNG, and EXIF rotation is applied. With `minSide`, an image whose
 * shorter side is smaller is refused.
 */
export async function makeWorkspacePicture(
  input: Buffer,
  size: number,
  options: { minSide?: number } = {},
): Promise<makeWorkspacePicture.Result> {
  let format: string | undefined
  let width: number | undefined
  let height: number | undefined
  try {
    ;({ format, width, height } = await sharp(input, {
      limitInputPixels: MAX_INPUT_PIXELS,
    }).metadata())
  } catch (err) {
    throw unreadable(err)
  }
  if (format !== 'png' && format !== 'jpeg' && format !== 'webp') {
    throw new InvalidImageError(`Expected a PNG, JPEG or WebP image, got ${format ?? 'unknown'}`)
  }
  if (options.minSide !== undefined && Math.min(width ?? 0, height ?? 0) < options.minSide) {
    throw new InvalidImageError(
      `The picture is ${width ?? 0} × ${height ?? 0} px; its shorter side must be at least ${options.minSide} px`,
    )
  }
  const png = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS })
    .rotate()
    .resize(size, size, { fit: 'cover', position: 'centre' })
    .png()
    .toBuffer()
  return { png, format }
}
