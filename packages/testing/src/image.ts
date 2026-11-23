import type sharpModule from 'sharp'

// Loaded on first use: sharp's native module costs ~350 ms to load, and most of the test files that
// import @circi/testing never make an image.
let loading: Promise<typeof sharpModule> | undefined
const loadSharp = (): Promise<typeof sharpModule> =>
  (loading ??= import('sharp').then((m) => m.default))

export namespace pngBytes {
  export interface Options {
    width?: number
    height?: number
    color?: string
    /** A filled rectangle drawn on top at (x, y): moving or recoloring it makes a visual change. */
    mark?: { x: number; y: number; w: number; h: number; color: string }
  }
}

/** A solid-colour PNG (default 60 x 40, white), with an optional filled rectangle on top. */
export async function pngBytes(options: pngBytes.Options = {}): Promise<Buffer> {
  const { width = 60, height = 40, color = '#ffffff', mark } = options
  const sharp = await loadSharp()
  const page = await sharp({ create: { width, height, channels: 4, background: color } })
    .png()
    .toBuffer()
  if (!mark) return page
  const patch = await sharp({
    create: { width: mark.w, height: mark.h, channels: 4, background: mark.color },
  })
    .png()
    .toBuffer()
  return sharp(page)
    .composite([{ input: patch, left: mark.x, top: mark.y }])
    .png()
    .toBuffer()
}

export namespace imageBytes {
  export interface Options extends Omit<pngBytes.Options, 'mark'> {
    format: 'png' | 'jpeg' | 'webp' | 'gif'
  }
}

/** A solid-colour image in any of the formats an upload may have (default 60 x 40, white). */
export async function imageBytes(options: imageBytes.Options): Promise<Buffer> {
  const { width = 60, height = 40, color = '#ffffff', format } = options
  const sharp = await loadSharp()
  return sharp({ create: { width, height, channels: 4, background: color } })
    .toFormat(format)
    .toBuffer()
}
