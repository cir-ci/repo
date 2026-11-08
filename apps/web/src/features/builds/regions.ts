import type { Comment } from '@circi/api'

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

const clamp01 = (n: number) => Math.min(1, Math.max(0, n))

/**
 * The region a drag from `a` to `b` covers on an image drawn in `box`, as fractions (0 to 1) of
 * its width and height: dragging in any direction works, a drag that leaves the image is clipped
 * to it, and one too small to mean anything gives null.
 */
export function regionFromPoints(box: Box, a: Point, b: Point): Comment.Region | null {
  if (box.width <= 0 || box.height <= 0) return null
  const fx = (p: Point) => clamp01((p.x - box.left) / box.width)
  const fy = (p: Point) => clamp01((p.y - box.top) / box.height)
  const x = Math.min(fx(a), fx(b))
  const y = Math.min(fy(a), fy(b))
  const width = Math.max(fx(a), fx(b)) - x
  const height = Math.max(fy(a), fy(b)) - y
  if (width < MIN_REGION || height < MIN_REGION) return null
  return { x, y, width, height }
}

/** The inline style that places a region over the image it is a fraction of. */
export function regionStyle(region: Comment.Region) {
  return {
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
