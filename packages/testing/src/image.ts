import sharp from 'sharp'

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
export function imageBytes(options: imageBytes.Options): Promise<Buffer> {
  const { width = 60, height = 40, color = '#ffffff', format } = options
  return sharp({ create: { width, height, channels: 4, background: color } })
    .toFormat(format)
    .toBuffer()
}
