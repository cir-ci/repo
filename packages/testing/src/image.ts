import sharp from 'sharp'

export namespace pngBytes {
  export interface Options {
    width?: number
    height?: number
    color?: string
  }
}

/** A solid-colour PNG (default 60 x 40, white). */
export function pngBytes(options: pngBytes.Options = {}): Promise<Buffer> {
  const { width = 60, height = 40, color = '#ffffff' } = options
  return sharp({ create: { width, height, channels: 4, background: color } })
    .png()
    .toBuffer()
}
