import { pngBytes } from '@circi/testing'
import sharp from 'sharp'

export interface ScreenshotSpec {
  width?: number
  height?: number
  background?: string
  /** A 20 px square in this colour at (x, y): moving it makes a visual change. */
  dot?: { x: number; y: number; color?: string }
}

/** A deterministic PNG: a plain page with an optional marker. */
export function screenshot(spec: ScreenshotSpec = {}): Promise<Buffer> {
  return pngBytes({
    width: spec.width ?? 400,
    height: spec.height ?? 300,
    color: spec.background ?? '#f8fafc',
    ...(spec.dot
      ? { mark: { x: spec.dot.x, y: spec.dot.y, w: 20, h: 20, color: spec.dot.color ?? '#2563eb' } }
      : {}),
  })
}

export async function imageSize(png: Buffer): Promise<{ width: number; height: number }> {
  const meta = await sharp(png).metadata()
  return { width: meta.width ?? 0, height: meta.height ?? 0 }
}
