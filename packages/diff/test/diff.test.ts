import sharp from 'sharp'
import { describe, expect, it } from 'vitest'

import {
  diffImages,
  InvalidImageError,
  makeThumbnail,
  makeWorkspacePicture,
  readPngInfo,
} from '#src/index.ts'

/** A solid-colour PNG, optionally with a filled rectangle on top. */
async function png(
  width: number,
  height: number,
  options: {
    color?: string
    rect?: { x: number; y: number; w: number; h: number; color: string }
  } = {},
): Promise<Buffer> {
  let img = sharp({
    create: { width, height, channels: 4, background: options.color ?? '#ffffff' },
  })
  if (options.rect) {
    const r = options.rect
    const patch = await sharp({
      create: { width: r.w, height: r.h, channels: 4, background: r.color },
    })
      .png()
      .toBuffer()
    img = sharp(await img.png().toBuffer()).composite([{ input: patch, left: r.x, top: r.y }])
  }
  return img.png().toBuffer()
}

describe('readPngInfo', () => {
  it('reads PNG dimensions', async () => {
    expect(await readPngInfo(await png(40, 30))).toEqual({ width: 40, height: 30 })
  })

  it('rejects non-PNG and garbage input', async () => {
    const jpeg = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#000' } })
      .jpeg()
      .toBuffer()
    await expect(readPngInfo(jpeg)).rejects.toThrow(/Expected a PNG, got jpeg/)
    await expect(readPngInfo(Buffer.from('not an image'))).rejects.toBeInstanceOf(InvalidImageError)
  })

  it('says in plain words what was wrong', async () => {
    const jpeg = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#000' } })
      .jpeg()
      .toBuffer()
    await expect(readPngInfo(jpeg)).rejects.toMatchObject({
      reason: "not a PNG (it's a JPEG file)",
    })
    await expect(readPngInfo(Buffer.from('not an image'))).rejects.toMatchObject({
      reason: 'not a PNG',
    })
    await expect(readPngInfo(Buffer.alloc(0))).rejects.toMatchObject({
      reason: 'the file is empty',
    })
    // The header is fine but the pixels stop short: found when the image is decoded.
    const whole = await png(60, 60)
    await expect(makeThumbnail(whole.subarray(0, whole.length - 30))).rejects.toMatchObject({
      name: 'InvalidImageError',
      reason: 'the file is corrupt or truncated',
    })
  })
})

describe('diffImages', () => {
  it('finds no change between identical renders', async () => {
    const a = await png(100, 100)
    const res = await diffImages(a, await png(100, 100))
    expect(res).toMatchObject({ changed: false, changedPixels: 0, score: 0, sizeChanged: false })
    expect(res.diffPng).toBeUndefined()
  })

  it('counts changed pixels and produces a diff image', async () => {
    const base = await png(100, 100)
    const head = await png(100, 100, { rect: { x: 10, y: 10, w: 10, h: 10, color: '#000000' } })
    const res = await diffImages(base, head)
    expect(res.changed).toBe(true)
    expect(res.changedPixels).toBe(100)
    expect(res.score).toBeCloseTo(0.01)
    expect(await readPngInfo(res.diffPng ?? Buffer.alloc(0))).toEqual({ width: 100, height: 100 })
  })

  it('treats changes within the project threshold as unchanged', async () => {
    const base = await png(100, 100)
    const head = await png(100, 100, { rect: { x: 0, y: 0, w: 1, h: 1, color: '#000000' } })
    expect((await diffImages(base, head, { threshold: 0.001 })).changed).toBe(false)
    expect((await diffImages(base, head, { threshold: 0 })).changed).toBe(true)
  })

  it('ignores colour noise below the pixel tolerance', async () => {
    const res = await diffImages(
      await png(50, 50, { color: '#ffffff' }),
      await png(50, 50, { color: '#fefefe' }),
    )
    expect(res.changedPixels).toBe(0)
  })

  it('always reports a size change as changed, even when it is a tiny share of pixels', async () => {
    // 1280×4000 grows by 2 px: the padded area is 0.05% of the canvas, under a 0.1% threshold.
    const base = await png(1280, 4000)
    const head = await png(1280, 4002)
    const res = await diffImages(base, head, { threshold: 0.001 })
    expect(res.score).toBeLessThan(0.001)
    expect(res).toMatchObject({
      sizeChanged: true,
      changed: true,
      width: 1280,
      height: 4002,
      base: { width: 1280, height: 4000 },
      head: { width: 1280, height: 4002 },
    })
  })
})

const clock = (color: string) => png(100, 100, { rect: { x: 10, y: 10, w: 20, h: 10, color } })

describe('diffImages ignoring regions', () => {
  it('does not see a change inside an ignored rectangle', async () => {
    const res = await diffImages(await clock('#000000'), await clock('#ff0000'), {
      ignore: [{ x: 10, y: 10, width: 20, height: 10 }],
    })
    expect(res).toMatchObject({ changed: false, changedPixels: 0 })
  })

  it('still sees changes outside it, and counts only those', async () => {
    const base = await png(100, 100, { rect: { x: 10, y: 10, w: 20, h: 10, color: '#000000' } })
    const head = await png(100, 100, {
      color: '#ffffff',
      rect: { x: 10, y: 10, w: 20, h: 10, color: '#ff0000' },
    })
    const other = await sharp(head)
      .composite([{ input: await png(5, 5, { color: '#000000' }), left: 80, top: 80 }])
      .png()
      .toBuffer()
    const res = await diffImages(base, other, { ignore: [{ x: 10, y: 10, width: 20, height: 10 }] })
    expect(res.changed).toBe(true)
    expect(res.changedPixels).toBe(25)
  })

  it('counts the differing pixels the mask hid, and which rectangles hid them', async () => {
    const res = await diffImages(await clock('#000000'), await clock('#ff0000'), {
      ignore: [
        { x: 60, y: 60, width: 10, height: 10 },
        { x: 10, y: 10, width: 20, height: 10 },
      ],
    })
    expect(res).toMatchObject({ changed: false, ignoredChangedPixels: 200, ignoredRegions: [1] })
    expect(await diffImages(await clock('#000000'), await clock('#ff0000'))).toMatchObject({
      changed: true,
      ignoredChangedPixels: 0,
      ignoredRegions: [],
    })
  })

  it('clips a region that runs off the image, and accepts several', async () => {
    const res = await diffImages(await clock('#000000'), await clock('#00ff00'), {
      ignore: [
        { x: 0, y: 0, width: 15, height: 1000 },
        { x: 14, y: 0, width: 5000, height: 1000 },
      ],
    })
    expect(res.changed).toBe(false)
  })
})

describe('makeThumbnail', () => {
  it('scales to 480 wide and keeps the top of tall pages', async () => {
    const thumb = await makeThumbnail(await png(1280, 8000))
    expect(thumb).toMatchObject({ width: 480, height: 720 })
    const meta = await sharp(thumb.webp).metadata()
    expect(meta.format).toBe('webp')
  })

  it('never enlarges small screenshots', async () => {
    expect(await makeThumbnail(await png(200, 100))).toMatchObject({ width: 200, height: 100 })
  })
})

describe('makeWorkspacePicture', () => {
  it('crops a wide PNG to the centre square and resizes it, keeping transparency', async () => {
    const wide = await sharp({
      create: {
        width: 600,
        height: 300,
        channels: 4,
        background: { r: 200, g: 0, b: 0, alpha: 0.5 },
      },
    })
      .png()
      .toBuffer()
    const { png: out, format } = await makeWorkspacePicture(wide, 256)
    expect(format).toBe('png')
    const meta = await sharp(out).metadata()
    expect([meta.format, meta.width, meta.height, meta.hasAlpha]).toEqual(['png', 256, 256, true])
  })

  it('takes JPEG and WebP, and always answers a PNG', async () => {
    const raw = { create: { width: 40, height: 80, channels: 3 as const, background: '#336699' } }
    const inputs = [await sharp(raw).jpeg().toBuffer(), await sharp(raw).webp().toBuffer()]
    const metas = await Promise.all(
      inputs.map(async (input) => sharp((await makeWorkspacePicture(input, 64)).png).metadata()),
    )
    expect(metas.map((m) => [m.format, m.width, m.height])).toEqual([
      ['png', 64, 64],
      ['png', 64, 64],
    ])
  })

  it('refuses other image types and bytes that are no image', async () => {
    const gif = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#000' } })
      .gif()
      .toBuffer()
    await expect(makeWorkspacePicture(gif, 64)).rejects.toThrow(/PNG, JPEG or WebP image, got gif/)
    await expect(makeWorkspacePicture(Buffer.from('<svg/>'), 64)).rejects.toBeInstanceOf(
      InvalidImageError,
    )
  })
})
