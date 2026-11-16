import type { Comment } from '@circi/api'
import type { CSSProperties } from 'react'

/** A pointer position, in the same coordinate space as the `Box` (client pixels). */
export interface Point {
  x: number
  y: number
}

/** The on-screen rectangle of the snapshot image (`getBoundingClientRect`). */
export interface Box {
  left: number
  top: number
  width: number
  height: number
}

/** A drag smaller than this fraction of the image in either direction is a click, not a region. */
export const MIN_REGION = 0.01

/** With always-on drawing, a drag smaller than this many pixels in either direction is a click. */
export const MIN_REGION_PX = 8

/** Where the keyboard region tool starts: a fifth of the image, in the middle. */
export const START_REGION: Comment.Region = { x: 0.4, y: 0.4, width: 0.2, height: 0.2 }

/** How far an arrow key moves or resizes the keyboard region tool: 1% of the image. */
export const REGION_STEP = 0.01

/** The smallest region the keyboard tool allows (twice the size below which a drag is a click). */
const MIN_TOOL = MIN_REGION * 2

const round4 = (n: number) => Math.round(n * 10_000) / 10_000

const clamp01 = (n: number) => Math.min(1, Math.max(0, n))

/**
 * The region a drag from `a` to `b` covers on an image drawn in `box`, as fractions (0 to 1) of
 * its width and height: dragging in any direction works, a drag that leaves the image is clipped
 * to it, and one too small to mean anything (under 1% of the image, or under `minPixels` on
 * screen) gives null.
 */
export function regionFromPoints(
  box: Box,
  a: Point,
  b: Point,
  minPixels = 0,
): Comment.Region | null {
  if (box.width <= 0 || box.height <= 0) return null
  if (Math.abs(a.x - b.x) < minPixels || Math.abs(a.y - b.y) < minPixels) return null
  const fx = (p: Point) => clamp01((p.x - box.left) / box.width)
  const fy = (p: Point) => clamp01((p.y - box.top) / box.height)
  const x = Math.min(fx(a), fx(b))
  const y = Math.min(fy(a), fy(b))
  const width = Math.max(fx(a), fx(b)) - x
  const height = Math.max(fy(a), fy(b)) - y
  if (width < MIN_REGION || height < MIN_REGION) return null
  return { x, y, width, height }
}

/**
 * The keyboard region tool's response to an arrow key: the region moved one step, or with
 * `resize` its width (left, right) or height (up, down) changed by one step. It stays inside the
 * image and never gets smaller than the tool's minimum. Undefined for any other key.
 */
export function nudgeRegion(
  region: Comment.Region,
  key: string,
  resize: boolean,
): Comment.Region | undefined {
  const dx = key === 'ArrowRight' ? 1 : key === 'ArrowLeft' ? -1 : 0
  const dy = key === 'ArrowDown' ? 1 : key === 'ArrowUp' ? -1 : 0
  if (dx === 0 && dy === 0) return undefined
  const step = REGION_STEP
  if (resize) {
    const width = Math.min(1 - region.x, Math.max(MIN_TOOL, region.width + dx * step))
    const height = Math.min(1 - region.y, Math.max(MIN_TOOL, region.height + dy * step))
    return { ...region, width: round4(width), height: round4(height) }
  }
  const x = Math.min(1 - region.width, Math.max(0, region.x + dx * step))
  const y = Math.min(1 - region.height, Math.max(0, region.y + dy * step))
  return { ...region, x: round4(x), y: round4(y) }
}

const percent = (n: number) => `${Math.round(n * 100)}%`

/** What a screen reader hears for the tool's region: "40% from the left, 40% from the top, 20% wide, 20% high". */
export function describeRegion(region: Comment.Region): string {
  return `${percent(region.x)} from the left, ${percent(region.y)} from the top, ${percent(region.width)} wide, ${percent(region.height)} high`
}

/** A style that only sets `--region`, the hue a region's box, pin and comment draw from. */
export function regionHueStyle(color: string): CSSProperties {
  return Object.fromEntries([['--region', color]])
}

/**
 * The inline style that places a region over the image it is a fraction of. With a `color` (a
 * numbered comment region's hue) it also sets `--region`, which the box, its pin, its handles and
 * the comment's marker draw from; without one they fall back to the annotation color.
 */
export function regionStyle(region: Comment.Region, color?: string) {
  return {
    ...(color === undefined ? {} : { '--region': color }),
    left: `${region.x * 100}%`,
    top: `${region.y * 100}%`,
    width: `${region.width * 100}%`,
    height: `${region.height * 100}%`,
  }
}

/** The threads of a snapshot that are pinned to a region, in order: markers number from 1. */
export function regionThreads(comments: readonly Comment.Item[], snapshotName: string) {
  return comments.filter(
    (c) =>
      c.parentId === null &&
      c.deletedAt === null &&
      c.region !== null &&
      c.snapshotName === snapshotName,
  )
}
