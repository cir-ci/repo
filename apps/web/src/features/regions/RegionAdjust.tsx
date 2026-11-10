import type { Comment } from '@circi/api'
import { type MouseEvent, type PointerEvent, useEffect, useRef, useState } from 'react'

import { adjustRegion, CORNERS, type Grab, pastSlop, sameRegion } from './regions.ts'

import styles from './RegionAdjust.module.css'

/** What a region needs to be moved and resized with the mouse: where the result goes. */
export interface Adjust {
  /** The drag ended somewhere new: the region as fractions of the image, to save. */
  onCommit: (region: Comment.Region) => void
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
  live: Comment.Region
}

/**
 * Direct manipulation of one existing region. Pressing its body and dragging moves it, pressing
 * a corner handle (`<RegionHandles />`, a child of the region) and dragging resizes it from that
 * corner; both stay inside the image and keep the draw gesture's minimum size, at any zoom (the
 * image's on-screen box is read when the press starts). Esc during a drag puts the region back.
 * A press that barely moves is a click and does what it always did. Without `adjust` this does
 * nothing, so everyone else gets no handles and no move cursor.
 *
 * `region` is what to show now: the live one while dragging, else the one passed in.
 */
export function useAdjustable(
  region: Comment.Region,
  adjust: Adjust | undefined,
): { region: Comment.Region; props: AdjustProps; adjusting: boolean } {
  const [drag, setDrag] = useState<Drag | null>(null)
  // After a real drag the click that follows the release must not open anything.
  const dragged = useRef(false)
  const target = useRef<HTMLElement | null>(null)
  const dragging = drag !== null

  useEffect(() => {
    if (!dragging) return undefined
    // In the capture phase, and stopped there: Esc during a drag cancels the drag only, and never
    // reaches a dialog the image is in (which would close).
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      setDrag(null)
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [dragging])

  if (!adjust) return { region, props: {}, adjusting: false }

  const props: AdjustProps = {
    'data-adjustable': '',
    ...(drag?.moved ? { 'data-adjusting': '' as const } : {}),
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
        live: region,
      })
    },
    onPointerMove(e) {
      if (!drag) return
      const dx = e.clientX - drag.from.x
      const dy = e.clientY - drag.from.y
      if (!drag.moved && !pastSlop(dx, dy)) return
      dragged.current = true
      setDrag({ ...drag, moved: true, live: adjustRegion(drag.start, drag.grab, dx, dy, drag.box) })
    },
    onPointerUp(e) {
      if (!drag) return
      setDrag(null)
      if (target.current?.hasPointerCapture(e.pointerId)) {
        target.current.releasePointerCapture(e.pointerId)
      }
      if (!drag.moved) adjust.onClick?.()
      else if (!sameRegion(drag.live, drag.start)) adjust.onCommit(drag.live)
    },
    onPointerCancel() {
      setDrag(null)
    },
    onClickCapture(e) {
      if (!dragged.current) return
      dragged.current = false
      e.preventDefault()
      e.stopPropagation()
    },
  }
  return { region: drag?.moved ? drag.live : region, props, adjusting: drag?.moved === true }
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
