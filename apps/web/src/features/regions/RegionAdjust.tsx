import type { Comment } from '@circi/api'
import { type MouseEvent, type PointerEvent, useEffect, useRef, useState } from 'react'

import { withScrolled } from './auto-scroll.ts'
import { adjustRegion, CORNERS, type Grab, pastSlop, sameRegion } from './regions.ts'
import { useAutoScroll } from './use-auto-scroll.ts'

import styles from './RegionAdjust.module.css'

/** What a region needs to be moved and resized with the mouse: where the result goes. */
export interface Adjust {
  /**
   * The drag ended somewhere new: the region as fractions of the image, to save. Return the save
   * (a promise) and the region stays where it was dropped until the save has settled and the data
   * shown reflects it: a release must never show the old region for a frame before the new one.
   */
  onCommit: (region: Comment.Region) => void | Promise<unknown>
  /** A press that never became a drag (the pointer stayed within a few pixels). */
  onClick?: (() => void) | undefined
}

/** The props to spread on the element that is the region (it must be positioned in the image's layer). */
export interface AdjustProps {
  'data-adjustable'?: ''
  'data-adjusting'?: ''
  onPointerDown?: (e: PointerEvent<HTMLElement>) => void
  onPointerMove?: (e: PointerEvent<HTMLElement>) => void
  onPointerUp?: (e: PointerEvent<HTMLElement>) => void
  onPointerCancel?: (e: PointerEvent<HTMLElement>) => void
  onClickCapture?: (e: MouseEvent<HTMLElement>) => void
}

interface Drag {
  grab: Grab
  from: { x: number; y: number }
  box: { left: number; top: number; width: number; height: number }
  start: Comment.Region
  /** Past the slop: this is a drag, not a click. */
  moved: boolean
  /** The pointer now, in client pixels (the area may have scrolled since: see `useAutoScroll`). */
  pointer: { x: number; y: number }
}

/**
 * Direct manipulation of one existing region. Pressing its body and dragging moves it, pressing
 * a corner handle (`<RegionHandles />`, a child of the region) and dragging resizes it from that
 * corner; both stay inside the image and keep the draw gesture's minimum size, at any zoom (the
 * image's on-screen box is read when the press starts). Esc during a drag puts the region back.
 * A press that barely moves is a click and does what it always did. Without `adjust` this does
 * nothing, so everyone else gets no handles and no move cursor.
 *
 * `region` is what to show now: the live one while dragging, the dropped one while its save is
 * in flight and the data has not caught up, else the one passed in.
 */
export function useAdjustable(
  region: Comment.Region,
  adjust: Adjust | undefined,
): { region: Comment.Region; props: AdjustProps; adjusting: boolean } {
  const [drag, setDrag] = useState<Drag | null>(null)
  // A region dropped and being saved: `base` is what the data held when it was dropped.
  const [held, setHeld] = useState<{ base: Comment.Region; to: Comment.Region } | null>(null)
  // After a real drag the click that follows the release must not open anything.
  const dragged = useRef(false)
  const target = useRef<HTMLElement | null>(null)
  const dragging = drag !== null
  // Near an edge of the scroll area the drag scrolls it, and the region follows the pointer in
  // the image's coordinates: what scrolled since the press counts as pointer travel.
  const auto = useAutoScroll()
  const stopAuto = auto.stop
  const travel = (d: Drag, scrolled: { x: number; y: number }) => {
    const at = withScrolled(d.pointer, scrolled)
    return { dx: at.x - d.from.x, dy: at.y - d.from.y }
  }
  const live = (() => {
    if (!drag) return null
    const { dx, dy } = travel(drag, auto.scrolled)
    return {
      ...drag,
      moved: drag.moved || pastSlop(dx, dy),
      region: adjustRegion(drag.start, drag.grab, dx, dy, drag.box),
    }
  })()

  useEffect(() => {
    if (!dragging) return undefined
    // In the capture phase, and stopped there: Esc during a drag cancels the drag only, and never
    // reaches a dialog the image is in (which would close).
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      setDrag(null)
      stopAuto()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [dragging, stopAuto])

  // The data moved on (the optimistic update or the refetch landed, or a failure rolled back): done holding.
  if (held && !sameRegion(region, held.base)) setHeld(null)
  const shown = held && sameRegion(region, held.base) ? held.to : region

  if (!adjust) return { region, props: {}, adjusting: false }

  const props: AdjustProps = {
    'data-adjustable': '',
    ...(live?.moved ? { 'data-adjusting': '' as const } : {}),
    onPointerDown(e) {
      if (e.button !== 0) return
      // The press is this region's: the layer under it must not start drawing a new one.
      e.stopPropagation()
      const layer = e.currentTarget.offsetParent
      if (!layer) return
      const { left, top, width, height } = layer.getBoundingClientRect()
      const grab = e.target instanceof HTMLElement ? cornerOf(e.target) : 'move'
      dragged.current = false
      target.current = e.currentTarget
      e.currentTarget.setPointerCapture(e.pointerId)
      setDrag({
        grab,
        from: { x: e.clientX, y: e.clientY },
        box: { left, top, width, height },
        start: region,
        moved: false,
        pointer: { x: e.clientX, y: e.clientY },
      })
      auto.start(e.currentTarget, { x: e.clientX, y: e.clientY })
    },
    onPointerMove(e) {
      if (!drag) return
      const pointer = { x: e.clientX, y: e.clientY }
      auto.move(pointer)
      const { dx, dy } = travel({ ...drag, pointer }, auto.read())
      const moved = drag.moved || pastSlop(dx, dy)
      if (moved) dragged.current = true
      setDrag({ ...drag, moved, pointer })
    },
    onPointerUp(e) {
      if (!drag) return
      const { dx, dy } = travel({ ...drag, pointer: { x: e.clientX, y: e.clientY } }, auto.read())
      const moved = drag.moved || pastSlop(dx, dy)
      const dropped = adjustRegion(drag.start, drag.grab, dx, dy, drag.box)
      auto.stop()
      setDrag(null)
      if (target.current?.hasPointerCapture(e.pointerId)) {
        target.current.releasePointerCapture(e.pointerId)
      }
      if (moved) dragged.current = true
      if (!moved) adjust.onClick?.()
      else if (!sameRegion(dropped, drag.start)) {
        const saving = adjust.onCommit(dropped)
        if (saving instanceof Promise) {
          // Cleared in the same batch as the drag, so no render shows the old region.
          setHeld({ base: drag.start, to: dropped })
          const release = () => setHeld(null)
          void saving.then(release, release)
        }
      }
    },
    onPointerCancel() {
      auto.stop()
      setDrag(null)
    },
    onClickCapture(e) {
      if (!dragged.current) return
      dragged.current = false
      e.preventDefault()
      e.stopPropagation()
    },
  }
  return { region: live?.moved ? live.region : shown, props, adjusting: live?.moved === true }
}

function cornerOf(element: HTMLElement): Grab {
  const corner = element.dataset['corner']
  return CORNERS.find((c) => c === corner) ?? 'move'
}

/**
 * The four corner handles, to put inside a region that uses `useAdjustable`. They are for the
 * pointer only (the keyboard has its own tool), so they are hidden from assistive technology;
 * each shows its resize cursor, and they appear while the region is hovered, selected or dragged.
 */
export function RegionHandles() {
  return CORNERS.map((corner) => (
    <span key={corner} aria-hidden="true" className={styles.handle} data-corner={corner} />
  ))
}
