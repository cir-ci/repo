import type { Comment } from '@circi/api'

import { type Box, MIN_REGION, MIN_REGION_PX } from './geometry.ts'

/**
 * Adjusting a region that already exists, by dragging it or one of its corners: the pure math.
 * Regions are fractions (0 to 1) of the image, a pointer moves in client pixels, and the image's
 * `Box` turns one into the other, so the same drag works at any zoom.
 */

/** The four corners a region can be resized from. */
export type Corner = 'nw' | 'ne' | 'sw' | 'se'

/** What a press on a region holds: its body (move) or one of its corners (resize). */
export type Grab = 'move' | Corner

export const CORNERS: readonly Corner[] = ['nw', 'ne', 'sw', 'se']

/** A press that moves less than this many pixels is a click, not a drag. */
export const DRAG_SLOP_PX = 3

/** The cursor a grab shows: a diagonal arrow for a corner (which diagonal), `move` for the body. */
export function cursorFor(grab: Grab): string {
  if (grab === 'move') return 'move'
  return grab === 'nw' || grab === 'se' ? 'nwse-resize' : 'nesw-resize'
}

/** Whether the pointer has gone far enough from where it went down to start a drag. */
export function pastSlop(dx: number, dy: number): boolean {
  return Math.max(Math.abs(dx), Math.abs(dy)) >= DRAG_SLOP_PX
}

/**
 * The smallest a region may be, as fractions of the image: `minPixels` on screen (the draw
 * gesture's 8), and never under the fraction a drawn region needs (1% of the image) either.
 */
export function minimumFractions(box: Box, minPixels = MIN_REGION_PX) {
  return {
    width: Math.min(1, Math.max(MIN_REGION, minPixels / Math.max(box.width, 1))),
    height: Math.min(1, Math.max(MIN_REGION, minPixels / Math.max(box.height, 1))),
  }
}

const clamp = (n: number, low: number, high: number) => Math.max(low, Math.min(high, n))

/**
 * The region after the pointer moved `dx`, `dy` client pixels from where it went down on `grab`.
 * Moving keeps the size and stops at the image's edges. Resizing moves the grabbed corner and
 * keeps the opposite one where it is: the grabbed corner stays inside the image and can't get
 * closer to the opposite one than the minimum size (it never flips over it).
 */
export function adjustRegion(
  region: Comment.Region,
  grab: Grab,
  dx: number,
  dy: number,
  box: Box,
  minPixels = MIN_REGION_PX,
): Comment.Region {
  if (box.width <= 0 || box.height <= 0) return region
  const fx = dx / box.width
  const fy = dy / box.height
  if (grab === 'move') {
    return {
      ...region,
      x: clamp(region.x + fx, 0, 1 - region.width),
      y: clamp(region.y + fy, 0, 1 - region.height),
    }
  }
  const min = minimumFractions(box, minPixels)
  const right = region.x + region.width
  const bottom = region.y + region.height
  let left = region.x
  let top = region.y
  let farX = right
  let farY = bottom
  if (grab === 'nw' || grab === 'sw') left = clamp(region.x + fx, 0, right - min.width)
  else farX = clamp(right + fx, region.x + min.width, 1)
  if (grab === 'nw' || grab === 'ne') top = clamp(region.y + fy, 0, bottom - min.height)
  else farY = clamp(bottom + fy, region.y + min.height, 1)
  return { x: left, y: top, width: farX - left, height: farY - top }
}

const close = (p: number, q: number) => Math.abs(p - q) < 1e-6

/** Whether two regions are the same rectangle (to a millionth: nothing to save). */
export function sameRegion(a: Comment.Region, b: Comment.Region): boolean {
  return close(a.x, b.x) && close(a.y, b.y) && close(a.width, b.width) && close(a.height, b.height)
}
