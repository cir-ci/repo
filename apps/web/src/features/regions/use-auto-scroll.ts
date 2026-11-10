import { useCallback, useEffect, useRef, useState } from 'react'

import { scrollStep, scrolledSince } from './auto-scroll.ts'
import type { Point } from './geometry.ts'

const ZERO: Point = { x: 0, y: 0 }

/** The marker `ScrollArea` puts on the element that scrolls. */
const SCROLLER = '[data-scroll-area]'

interface Run {
  el: HTMLElement
  /** Where the area was scrolled when the drag started. */
  origin: Point
  pointer: Point
  frame: number
  onScroll: () => void
}

const positionOf = (el: HTMLElement): Point => ({ x: el.scrollLeft, y: el.scrollTop })

/** Whole pixels, at least one: a fractional scroll can be rounded away. */
const whole = (v: number) => (v === 0 ? 0 : Math.sign(v) * Math.max(1, Math.round(Math.abs(v))))

export interface AutoScroll {
  /** How far the area has scrolled since `start`, per axis (zero while idle): re-renders as it changes. */
  scrolled: Point
  /** The same, read now: for the pointer's release, which must not wait for a render. */
  read: () => Point
  /**
   * Begin watching a drag that started on `from`: if it sits in a `ScrollArea`, that area scrolls
   * while the pointer is within 32px of its edges or past them, a frame at a time, up to its ends.
   * Does nothing when no scroll area holds `from` (the enlarged view, a page that scrolls itself).
   */
  start: (from: Element, pointer: Point) => void
  /** The pointer moved (client pixels). */
  move: (pointer: Point) => void
  /** The drag ended, was cancelled or was unmounted. */
  stop: () => void
}

/**
 * The one place a region drag scrolls its area: drawing a region and moving or resizing one both
 * use it. A drag measures its image once, when the press lands; the caller adds `scrolled` to the
 * pointer (`withScrolled`) so the region's edge stays under the pointer while the image moves.
 */
export function useAutoScroll(): AutoScroll {
  const [scrolled, setScrolled] = useState<Point>(ZERO)
  const run = useRef<Run | null>(null)

  const read = useCallback(() => {
    const r = run.current
    return r ? scrolledSince(positionOf(r.el), r.origin) : ZERO
  }, [])

  const sync = useCallback(() => {
    const next = read()
    setScrolled((prev) => (prev.x === next.x && prev.y === next.y ? prev : next))
  }, [read])

  const stop = useCallback(() => {
    const r = run.current
    if (!r) return
    run.current = null
    cancelAnimationFrame(r.frame)
    r.el.removeEventListener('scroll', r.onScroll)
    setScrolled((prev) => (prev === ZERO ? prev : ZERO))
  }, [])

  const start = useCallback(
    (from: Element, pointer: Point) => {
      stop()
      const el = from.closest(SCROLLER)
      if (!(el instanceof HTMLElement)) return
      const r: Run = { el, origin: positionOf(el), pointer, frame: 0, onScroll: sync }
      run.current = r
      el.addEventListener('scroll', r.onScroll, { passive: true })
      const tick = () => {
        const step = scrollStep(el.getBoundingClientRect(), r.pointer)
        if (step.x !== 0 || step.y !== 0) {
          el.scrollLeft += whole(step.x)
          el.scrollTop += whole(step.y)
          sync()
        }
        r.frame = requestAnimationFrame(tick)
      }
      r.frame = requestAnimationFrame(tick)
    },
    [stop, sync],
  )

  const move = useCallback((pointer: Point) => {
    const r = run.current
    if (r) r.pointer = pointer
  }, [])

  useEffect(() => stop, [stop])

  return { scrolled, read, start, move, stop }
}
