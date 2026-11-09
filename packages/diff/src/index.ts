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
    throw new InvalidImageError(
      `Not a readable image: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
  if (meta.format !== 'png')
    throw new InvalidImageError(`Expected a PNG, got ${meta.format ?? 'unknown'}`)
  if (!meta.width || !meta.height) throw new InvalidImageError('PNG has no dimensions')
  return { width: meta.width, height: meta.height }
}

export namespace diffImages {
  export interface Options {
    /**
     * Per-pixel colour tolerance passed to pixelmatch (0–1, perceptual distance). The default
     * 0.1 ignores imperceptible noise. This is not the team's diff threshold, which applies
     * to the share of changed pixels.
     */
    pixelTolerance?: number
    /** Team diff threshold: share of changed pixels (0–1) still considered unchanged. */
    threshold?: number
    /** Rectangles (in pixels) that are blanked in both images first: clocks, ads, avatars… */
    ignore?: readonly diffImages.IgnoreRegion[]
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
  for (const region of options.ignore ?? []) {
    blank(baseRaw, width, height, region)
    blank(headRaw, width, height, region)
  }
  const output = new Uint8Array(width * height * 4)
  const changedPixels = pixelmatch(baseRaw, headRaw, output, width, height, {
    threshold: options.pixelTolerance ?? 0.1,
    includeAA: false,
    alpha: 0.15,
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
  info: readPngInfo.Info,
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
 * kept; the result is always a PNG, and EXIF rotation is applied.
 */
export async function makeWorkspacePicture(
  input: Buffer,
  size: number,
): Promise<makeWorkspacePicture.Result> {
  let format: string | undefined
  try {
    format = (await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS }).metadata()).format
  } catch (err) {
    throw new InvalidImageError(
      `Not a readable image: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
  if (format !== 'png' && format !== 'jpeg' && format !== 'webp') {
    throw new InvalidImageError(`Expected a PNG, JPEG or WebP image, got ${format ?? 'unknown'}`)
  }
  const png = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS })
    .rotate()
    .resize(size, size, { fit: 'cover', position: 'centre' })
    .png()
    .toBuffer()
  return { png, format }
}
