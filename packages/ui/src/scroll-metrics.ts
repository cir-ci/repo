/** The scroll metrics of one axis of a scroll area, in pixels. */
export interface AxisMetrics {
  /** The visible length (`clientHeight` / `clientWidth`). */
  viewport: number
  /** The whole length (`scrollHeight` / `scrollWidth`). */
  content: number
  /** The scroll position (`scrollTop` / `scrollLeft`). */
  scroll: number
}

/** A thumb along its track: its length and its distance from the track's start. */
export interface Thumb {
  size: number
  offset: number
}

/** The shortest a thumb gets, so it stays easy to grab on a very long page. */
export const MIN_THUMB = 24

const clamp = (n: number, low: number, high: number) => Math.max(low, Math.min(high, n))

/** The most the content can scroll. */
export const maxScroll = ({ viewport, content }: AxisMetrics) => Math.max(0, content - viewport)

/** Whether the content is longer than the viewport (by more than a rounding error). */
export const overflows = ({ viewport, content }: AxisMetrics) => content - viewport > 0.5

/**
 * The thumb for an axis, along a track `track` pixels long (the viewport, less the corner when
 * the other axis has a thumb too): its length is the visible share of the track, and its offset
 * follows the scroll position. Null when nothing overflows, so there is no thumb at all.
 */
export function thumbFor(axis: AxisMetrics, track: number, minSize = MIN_THUMB): Thumb | null {
  if (!overflows(axis) || track <= 0) return null
  const size = clamp((track * axis.viewport) / axis.content, Math.min(minSize, track), track)
  const max = maxScroll(axis)
  const offset = max > 0 ? clamp(axis.scroll / max, 0, 1) * (track - size) : 0
  return { size, offset }
}

/**
 * The scroll position after the thumb was dragged `delta` pixels along its track from where the
 * drag started (`startScroll`): the thumb's travel is the track less the thumb, and covers the
 * whole scrollable length. Clamped to the ends.
 */
export function scrollForDrag(
  axis: AxisMetrics,
  track: number,
  thumb: Thumb,
  startScroll: number,
  delta: number,
): number {
  const travel = track - thumb.size
  const max = maxScroll(axis)
  if (travel <= 0 || max <= 0) return clamp(startScroll, 0, max)
  return clamp(startScroll + (delta * max) / travel, 0, max)
}

/**
 * Which way a press on the track pages the content: -1 (toward the start) when it lands before
 * the thumb, 1 when after, 0 on the thumb itself. `at` is measured from the track's start.
 */
export function pageDirection(thumb: Thumb, at: number): -1 | 0 | 1 {
  if (at < thumb.offset) return -1
  if (at > thumb.offset + thumb.size) return 1
  return 0
}

/** The scroll position one page in `direction`: a viewport, less a tenth for context. Clamped. */
export function pageScroll(axis: AxisMetrics, direction: -1 | 1): number {
  return clamp(axis.scroll + direction * axis.viewport * 0.9, 0, maxScroll(axis))
}
