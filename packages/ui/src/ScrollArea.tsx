import {
  type ComponentPropsWithoutRef,
  type PointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'

import { cx } from './cx.ts'
import {
  type AxisMetrics,
  pageDirection,
  pageScroll,
  scrollForDrag,
  type Thumb,
  thumbFor,
} from './scroll-metrics.ts'

import styles from './ScrollArea.module.css'

/** How long the thumbs stay after the last scroll, or after the pointer left. */
const HIDE_MS = 1000

/** The thumb's thickness, which a track leaves free at the corner when both axes have one. */
const THICKNESS = 6

type Axis = 'x' | 'y'

interface Geometry {
  x: Thumb | null
  y: Thumb | null
  /** Track lengths, for dragging. */
  trackX: number
  trackY: number
}

const NONE: Geometry = { x: null, y: null, trackX: 0, trackY: 0 }

const metricsOf = (el: HTMLElement, axis: Axis): AxisMetrics =>
  axis === 'y'
    ? { viewport: el.clientHeight, content: el.scrollHeight, scroll: el.scrollTop }
    : { viewport: el.clientWidth, content: el.scrollWidth, scroll: el.scrollLeft }

function measure(el: HTMLElement): Geometry {
  const y = metricsOf(el, 'y')
  const x = metricsOf(el, 'x')
  const both = thumbFor(y, y.viewport) !== null && thumbFor(x, x.viewport) !== null
  // With both thumbs, each track stops short of the corner.
  const trackY = both ? y.viewport - THICKNESS : y.viewport
  const trackX = both ? x.viewport - THICKNESS : x.viewport
  return { y: thumbFor(y, trackY), x: thumbFor(x, trackX), trackY, trackX }
}

const sameThumb = (a: Thumb | null, b: Thumb | null) =>
  a === b || (a !== null && b !== null && a.size === b.size && a.offset === b.offset)

/**
 * A scroll area with overlay scrollbars: the scroller keeps scrolling natively (wheel, keys,
 * touch, focus), its own bars are hidden so the content runs to the edge, and slim 6px thumbs
 * are drawn on top, only for an axis that overflows. They show while scrolling or while the
 * pointer is over the area, and fade out about a second later (no fade under reduced motion).
 * Drag a thumb to scroll; press the track beside it to page. They are `aria-hidden`: assistive
 * technology and the keyboard use the scroller itself.
 *
 * `className` and the rest of the props go on the scroller (the element that scrolls: give it
 * its padding, background and gap); `rootClassName` styles the frame around it, which fills its
 * parent like a flex item (`flex: 1 1 0`) and carries the thumbs. The scroller is marked
 * `data-scroll-area`. The thumbs follow the area and its content through a ResizeObserver, and
 * the scroll event.
 */
export function ScrollArea({ className, rootClassName, children, ...props }: ScrollArea.Props) {
  const scroller = useRef<HTMLDivElement | null>(null)
  const [geometry, setGeometry] = useState<Geometry>(NONE)
  const [visible, setVisible] = useState(false)
  const hovering = useRef(false)
  const dragging = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const drag = useRef<{ axis: Axis; from: number; start: number; thumb: Thumb } | null>(null)
  const [dragAxis, setDragAxis] = useState<Axis | null>(null)

  const refresh = useCallback(() => {
    const el = scroller.current
    if (!el) return
    const next = measure(el)
    setGeometry((prev) =>
      sameThumb(prev.x, next.x) &&
      sameThumb(prev.y, next.y) &&
      prev.trackX === next.trackX &&
      prev.trackY === next.trackY
        ? prev
        : next,
    )
  }, [])

  const show = useCallback(() => {
    setVisible(true)
    clearTimeout(timer.current)
    if (hovering.current || dragging.current) return
    timer.current = setTimeout(() => setVisible(false), HIDE_MS)
  }, [])

  useEffect(() => {
    const el = scroller.current
    if (!el) return undefined
    const observer = new ResizeObserver(refresh)
    const watch = () => {
      observer.disconnect()
      observer.observe(el)
      for (const child of el.children) observer.observe(child)
    }
    watch()
    // Children come and go (images, banners): watch the new ones too.
    const mutations = new MutationObserver(() => {
      watch()
      refresh()
    })
    mutations.observe(el, { childList: true })
    const onScroll = () => {
      refresh()
      show()
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    refresh()
    return () => {
      observer.disconnect()
      mutations.disconnect()
      el.removeEventListener('scroll', onScroll)
      clearTimeout(timer.current)
    }
  }, [refresh, show])

  const along = (axis: Axis, e: PointerEvent) => (axis === 'y' ? e.clientY : e.clientX)

  const press = (axis: Axis, thumb: Thumb) => (e: PointerEvent<HTMLElement>) => {
    const el = scroller.current
    if (!el || e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      // A synthetic pointer cannot be captured; its events still reach the thumb.
    }
    dragging.current = true
    setDragAxis(axis)
    drag.current = { axis, from: along(axis, e), start: metricsOf(el, axis).scroll, thumb }
    show()
  }

  const move = (axis: Axis, track: number) => (e: PointerEvent<HTMLElement>) => {
    const el = scroller.current
    const d = drag.current
    if (!el || !d || d.axis !== axis) return
    const next = scrollForDrag(
      metricsOf(el, axis),
      track,
      d.thumb,
      d.start,
      along(axis, e) - d.from,
    )
    if (axis === 'y') el.scrollTop = next
    else el.scrollLeft = next
  }

  const release = (e: PointerEvent<HTMLElement>) => {
    if (!drag.current) return
    drag.current = null
    dragging.current = false
    setDragAxis(null)
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
    show()
  }

  const page = (axis: Axis, thumb: Thumb) => (e: PointerEvent<HTMLElement>) => {
    const el = scroller.current
    if (!el || e.button !== 0 || e.target !== e.currentTarget) return
    e.preventDefault()
    e.stopPropagation()
    const rect = e.currentTarget.getBoundingClientRect()
    const at = axis === 'y' ? e.clientY - rect.top : e.clientX - rect.left
    const direction = pageDirection(thumb, at)
    if (direction === 0) return
    const next = pageScroll(metricsOf(el, axis), direction)
    el.scrollTo(axis === 'y' ? { top: next } : { left: next })
  }

  const track = (axis: Axis, thumb: Thumb | null, length: number) =>
    thumb ? (
      <div
        aria-hidden="true"
        className={styles.track}
        data-axis={axis}
        data-visible={visible || dragAxis === axis ? '' : undefined}
        data-testid={`scrollbar-${axis}`}
        style={axis === 'y' ? { height: length } : { width: length }}
        onPointerDown={page(axis, thumb)}
      >
        <div
          className={styles.thumb}
          data-dragging={dragAxis === axis ? '' : undefined}
          style={
            axis === 'y'
              ? { top: thumb.offset, height: thumb.size }
              : { left: thumb.offset, width: thumb.size }
          }
          onPointerDown={press(axis, thumb)}
          onPointerMove={move(axis, length)}
          onPointerUp={release}
          onPointerCancel={release}
        />
      </div>
    ) : null

  return (
    <div
      className={cx(styles.root, rootClassName)}
      onPointerEnter={() => {
        hovering.current = true
        show()
      }}
      onPointerLeave={() => {
        hovering.current = false
        show()
      }}
    >
      <div {...props} ref={scroller} className={cx(styles.scroller, className)} data-scroll-area="">
        {children}
      </div>
      {track('y', geometry.y, geometry.trackY)}
      {track('x', geometry.x, geometry.trackX)}
    </div>
  )
}

export namespace ScrollArea {
  export interface Props extends ComponentPropsWithoutRef<'div'> {
    /** Styles the frame around the scroller (its size in the parent). */
    rootClassName?: string | undefined
  }
}
