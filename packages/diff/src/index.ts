import pixelmatch from 'pixelmatch'
import sharp, { type Metadata } from 'sharp'

/**
 * Image work for the worker (PLAN §7.3): validate screenshots, diff two of them, and make
 * thumbnails. Pure functions over buffers so they're easy to test with generated images.
 */

/** Refuse decompression bombs: 100 megapixels is far beyond any real screenshot. */
const MAX_INPUT_PIXELS = 100_000_000

export class InvalidImageError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidImageError'
  }
}

export interface ImageInfo {
  width: number
  height: number
}

/** Checks the bytes really are a PNG (whatever the client claimed) and reads its size. */
export async function readPngInfo(png: Buffer): Promise<ImageInfo> {
  let meta: Metadata
  try {
    meta = await sharp(png, { limitInputPixels: MAX_INPUT_PIXELS }).metadata()
  } catch (err) {
    throw new InvalidImageError(
      `Not a readable image: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
  if (meta.format !== 'png')
    throw new InvalidImageError(`Expected a PNG, got ${meta.format ?? 'unknown'}`)
  if (!meta.width || !meta.height) throw new InvalidImageError('PNG has no dimensions')
  return { width: meta.width, height: meta.height }
}

export interface DiffOptions {
  /**
   * Per-pixel colour tolerance passed to pixelmatch (0–1, perceptual distance). The default
   * 0.1 ignores imperceptible noise. This is not the project's diff threshold, which applies
   * to the share of changed pixels.
   */
  pixelTolerance?: number
  /** Project diff threshold: share of changed pixels (0–1) still considered unchanged. */
  threshold?: number
}

export interface DiffResult {
  base: ImageInfo
  head: ImageInfo
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
}

export async function diffImages(
  basePng: Buffer,
  headPng: Buffer,
  options: DiffOptions = {},
): Promise<DiffResult> {
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
  const output = new Uint8Array(width * height * 4)
  const changedPixels = pixelmatch(baseRaw, headRaw, output, width, height, {
    threshold: options.pixelTolerance ?? 0.1,
    includeAA: false,
    alpha: 0.15,
  })
  const score = changedPixels / (width * height)
  const changed = sizeChanged || score > (options.threshold ?? 0)

  const result: DiffResult = {
    base,
    head,
    width,
    height,
    sizeChanged,
    changedPixels,
    score,
    changed,
  }
  if (changed) {
    result.diffPng = await sharp(output, { raw: { width, height, channels: 4 } })
      .png({ compressionLevel: 9 })
      .toBuffer()
  }
  return result
}

async function toRgbaCanvas(
  png: Buffer,
  info: ImageInfo,
  width: number,
  height: number,
): Promise<Uint8Array> {
  const data = await sharp(png, { limitInputPixels: MAX_INPUT_PIXELS })
    .ensureAlpha()
    .extend({
      right: width - info.width,
      bottom: height - info.height,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .raw()
    .toBuffer()
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
}

export interface Thumbnail {
  webp: Buffer
  width: number
  height: number
}

const THUMB_WIDTH = 480
const THUMB_MAX_HEIGHT = 720

/** List thumbnail: the top of the screenshot, at most 480×720, as WebP. */
export async function makeThumbnail(png: Buffer): Promise<Thumbnail> {
  const info = await readPngInfo(png)
  const scale = Math.min(1, THUMB_WIDTH / info.width)
  const scaledHeight = Math.max(1, Math.round(info.height * scale))
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
}
