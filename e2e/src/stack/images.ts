import sharp from 'sharp'

export interface ScreenshotSpec {
  width?: number
  height?: number
  background?: string
  /** A 20 px square in this colour at (x, y): moving it makes a visual change. */
  dot?: { x: number; y: number; color?: string }
}

/** A deterministic PNG: a plain page with an optional marker. */
export async function screenshot(spec: ScreenshotSpec = {}): Promise<Buffer> {
  const base = sharp({
    create: {
      width: spec.width ?? 400,
      height: spec.height ?? 300,
      channels: 4,
      background: spec.background ?? '#f8fafc',
    },
  })
  let out = await base.png().toBuffer()
  if (spec.dot) {
    const mark = await sharp({
      create: { width: 20, height: 20, channels: 4, background: spec.dot.color ?? '#2563eb' },
    })
      .png()
      .toBuffer()
    out = await sharp(out)
      .composite([{ input: mark, left: spec.dot.x, top: spec.dot.y }])
      .png()
      .toBuffer()
  }
  return out
}

export async function imageSize(png: Buffer): Promise<{ width: number; height: number }> {
  const meta = await sharp(png).metadata()
  return { width: meta.width ?? 0, height: meta.height ?? 0 }
}
