import type { Point } from './geometry.ts'

/** How near an edge of the scroll area the pointer must come before the area starts to scroll. */
export const EDGE_PX = 32

/** The most the area scrolls in one frame. */
export const MAX_STEP_PX = 20

/** A scroll area's on-screen rectangle (`getBoundingClientRect`). */
export interface Rect {
  left: number
  top: number
  right: number
  bottom: number
}

/**
 * How far to scroll along one axis this frame, from the pointer's place between the area's
 * `start` and `end` edges (client pixels): nothing while it is more than `edge` inside, then
 * faster the closer it gets (half the top speed at the edge itself), and the top speed once it
 * is a full `edge` past it. Negative toward the start. In an area too small to have a middle,
 * the nearer edge wins.
 */
export function edgeVelocity(
  pointer: number,
  start: number,
  end: number,
  edge = EDGE_PX,
  max = MAX_STEP_PX,
): number {
  const intoStart = start + edge - pointer
  const intoEnd = pointer - (end - edge)
  const speed = (depth: number) => max * Math.min(1, depth / (2 * edge))
  if (intoStart > 0 && intoStart >= intoEnd) return -speed(intoStart)
  return intoEnd > 0 ? speed(intoEnd) : 0
}

/** The scroll to apply this frame on both axes for a pointer at `pointer` over `rect`. */
export function scrollStep(rect: Rect, pointer: Point, edge = EDGE_PX, max = MAX_STEP_PX): Point {
  return {
    x: edgeVelocity(pointer.x, rect.left, rect.right, edge, max),
    y: edgeVelocity(pointer.y, rect.top, rect.bottom, edge, max),
  }
}

/**
 * Where the pointer is in the coordinates the drag started in. A drag measures its image once, at
 * the press; when the area then scrolls, the image moves under the pointer by the scrolled
 * distance, so the point under the pointer is the client position plus that distance.
 */
export function withScrolled(pointer: Point, scrolled: Point): Point {
  return { x: pointer.x + scrolled.x, y: pointer.y + scrolled.y }
}

/** How far an area has scrolled since the drag started, per axis. */
export function scrolledSince(now: Point, origin: Point): Point {
  return { x: now.x - origin.x, y: now.y - origin.y }
}
