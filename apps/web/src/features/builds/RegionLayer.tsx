import type { Comment } from '@circi/api'
import { type PointerEvent, useState } from 'react'

import { type Box, type Point, regionFromPoints, regionStyle } from './regions.ts'

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
 * rectangle, kept as fractions of the image so it holds at any zoom.
 */
export function RegionLayer({ annotations }: RegionLayer.Props) {
  const [drag, setDrag] = useState<{ from: Point; to: Point; box: Box } | null>(null)
  const { drawing } = annotations

  const live = drag ? regionFromPoints(drag.box, drag.from, drag.to) : null

  function down(e: PointerEvent<HTMLDivElement>) {
    if (!drawing || e.button !== 0) return
    e.preventDefault()
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
    </div>
  )
}

export namespace RegionLayer {
  export interface Props {
    annotations: Annotations
  }
}
