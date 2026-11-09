import type { Comment } from '@circi/api'
import { useAnnounce, visuallyHidden } from '@circi/ui'
import { type KeyboardEvent, type PointerEvent, useEffect, useId, useRef, useState } from 'react'

import {
  type Box,
  describeRegion,
  nudgeRegion,
  type Point,
  regionFromPoints,
  regionStyle,
  START_REGION,
} from './geometry.ts'

import styles from './RegionLayer.module.css'

/** The comment regions of the snapshot on screen, and what drawing a new one needs. */
export interface Annotations {
  /** Pinned threads of this snapshot, numbered like their cards in the Comments tab. */
  threads: { id: string; number: number; region: Comment.Region }[]
  /** The region drawn and not yet sent. */
  pending: Comment.Region | null
  focusedId: string | null
  /** While on, a drag over the image draws a region. */
  drawing: boolean
  onDrawingChange: (drawing: boolean) => void
  onDraw: (region: Comment.Region) => void
  onMarker: (id: string) => void
}

/**
 * A transparent layer over a snapshot image (the parent is positioned and exactly as big as the
 * image). Markers are buttons in the annotation colour; with `drawing` on, dragging draws a
 * rectangle, kept as fractions of the image so it holds at any zoom. The same tool works from
 * the keyboard (`RegionTool`): focus lands on a region in the middle of the image, the arrow keys
 * move it, Shift and the arrow keys resize it, Enter confirms and Escape cancels.
 */
export function RegionLayer({ annotations }: RegionLayer.Props) {
  const [drag, setDrag] = useState<{ from: Point; to: Point; box: Box } | null>(null)
  const { drawing } = annotations

  const live = drag ? regionFromPoints(drag.box, drag.from, drag.to) : null

  function down(e: PointerEvent<HTMLDivElement>) {
    if (!drawing || e.button !== 0) return
    e.preventDefault()
    // Drawing with the pointer: the keyboard tool's box steps aside.
    if (
      document.activeElement instanceof HTMLElement &&
      document.activeElement.dataset['tool'] !== undefined
    ) {
      document.activeElement.blur()
    }
    e.currentTarget.setPointerCapture(e.pointerId)
    const at = { x: e.clientX, y: e.clientY }
    const { left, top, width, height } = e.currentTarget.getBoundingClientRect()
    setDrag({ from: at, to: at, box: { left, top, width, height } })
  }

  function move(e: PointerEvent<HTMLDivElement>) {
    if (drag) setDrag({ ...drag, to: { x: e.clientX, y: e.clientY } })
  }

  function up(e: PointerEvent<HTMLDivElement>) {
    if (!drag) return
    const region = regionFromPoints(drag.box, drag.from, { x: e.clientX, y: e.clientY })
    setDrag(null)
    if (region) annotations.onDraw(region)
  }

  return (
    <div
      className={styles.layer}
      data-drawing={drawing ? '' : undefined}
      data-testid="region-layer"
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={() => setDrag(null)}
    >
      {annotations.threads.map((t) => (
        <button
          key={t.id}
          type="button"
          className={styles.marker}
          style={regionStyle(t.region)}
          data-focused={t.id === annotations.focusedId ? '' : undefined}
          aria-label={`Comment ${t.number}`}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => annotations.onMarker(t.id)}
        >
          <span aria-hidden="true" className={styles.number}>
            {t.number}
          </span>
        </button>
      ))}
      {annotations.pending ? (
        <span className={styles.marker} data-pending="" style={regionStyle(annotations.pending)} />
      ) : null}
      {live ? <span className={styles.marker} data-pending="" style={regionStyle(live)} /> : null}
      {drawing ? (
        <RegionTool
          onConfirm={annotations.onDraw}
          onCancel={() => annotations.onDrawingChange(false)}
        />
      ) : null}
    </div>
  )
}

/**
 * The keyboard way to place a region: a focusable box that starts in the middle of the image.
 * Arrow keys move it, Shift and arrows resize it, Enter confirms (the same `onDraw` a drag ends
 * with) and Escape cancels, returning focus to where it was. Each change is announced.
 */
function RegionTool({ onConfirm, onCancel }: RegionTool.Props) {
  const ref = useRef<HTMLDivElement>(null)
  const before = useRef<Element | null>(null)
  const helpId = useId()
  const announce = useAnnounce()
  const [region, setRegion] = useState(START_REGION)

  // Focus arrives with the tool, so a keyboard user who turned drawing on can start at once.
  useEffect(() => {
    before.current = document.activeElement
    ref.current?.focus()
    announce(
      'Drawing a region. Arrow keys move it, Shift and arrow keys resize it, Enter confirms, Escape cancels.',
    )
  }, [announce])

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Enter') {
      e.preventDefault()
      announce(`Region marked, ${describeRegion(region)}`)
      onConfirm(region)
      return
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      announce('Region cancelled')
      onCancel()
      if (before.current instanceof HTMLElement && before.current.isConnected) {
        before.current.focus()
      }
      return
    }
    const next = nudgeRegion(region, e.key, e.shiftKey)
    if (!next) return
    e.preventDefault()
    setRegion(next)
    announce(describeRegion(next))
  }

  return (
    <>
      <div
        ref={ref}
        tabIndex={0}
        role="group"
        aria-label="Region to mark"
        aria-describedby={helpId}
        data-tool=""
        className={styles.tool}
        style={regionStyle(region)}
        onKeyDown={onKeyDown}
      />
      <span id={helpId} style={visuallyHidden}>
        Arrow keys move the region. Shift and arrow keys resize it. Enter confirms. Escape cancels.
      </span>
    </>
  )
}

namespace RegionTool {
  export interface Props {
    onConfirm: (region: Comment.Region) => void
    onCancel: () => void
  }
}

export namespace RegionLayer {
  export interface Props {
    annotations: Annotations
  }
}
