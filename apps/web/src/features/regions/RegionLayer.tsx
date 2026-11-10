import type { Comment } from '@circi/api'
import { Avatar, Button, Kbd, useAnnounce, visuallyHidden } from '@circi/ui'
import {
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  type RefObject,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'

import { MentionField } from '#lib/MentionField.tsx'
import type { Mention } from '#lib/mentions.ts'
import { isSubmitKey } from '#lib/shortcuts.ts'

import {
  type Box,
  describeRegion,
  MIN_REGION_PX,
  nudgeRegion,
  type Point,
  popoverSide,
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
  /** While on, a drag over the image draws a region, and the keyboard tool is shown. */
  drawing: boolean
  onDrawingChange: (drawing: boolean) => void
  onDraw: (region: Comment.Region) => void
  onMarker: (id: string) => void
  /**
   * Drawing is always on: a drag of at least 8 × 8 pixels draws a region (`onDraw`), a smaller
   * one is a click (`onClick`). `drawing` then only means the keyboard tool is showing.
   */
  alwaysDraw?: boolean
  onClick?: () => void
  /** Drawn under the markers: the ignore regions shown while a drag draws one. */
  underlay?: ReactNode
  /** With the pending region: the comment popover anchored to it. */
  composer?: RegionComposer.Callbacks
}

/** The pointer side of drawing: handlers for whatever element the drag happens on, and the live box. */
export interface Gesture {
  bind: {
    onPointerDown: (e: PointerEvent<HTMLElement>) => void
    onPointerMove: (e: PointerEvent<HTMLElement>) => void
    onPointerUp: (e: PointerEvent<HTMLElement>) => void
    onPointerCancel: () => void
  }
  live: Comment.Region | null
}

/**
 * Drag to draw. Esc cancels a drag in progress. With `alwaysDraw` a drag under 8 pixels in either
 * direction is a click, answered with `onClick`; without it nothing happens (the old tool: the
 * caller switched drawing on first). The handlers go on the element the drag starts on: the
 * layer itself, or a parent that also holds the image's click target.
 */
export function useRegionGesture(annotations: Annotations | undefined): Gesture {
  const [drag, setDrag] = useState<{ from: Point; to: Point; box: Box } | null>(null)
  const drawing = annotations?.drawing ?? false
  const alwaysDraw = annotations?.alwaysDraw ?? false
  const active = drawing || alwaysDraw
  const minPixels = alwaysDraw ? MIN_REGION_PX : 0
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

  return {
    live: drag ? regionFromPoints(drag.box, drag.from, drag.to, minPixels) : null,
    bind: {
      onPointerDown(e) {
        if (!active || e.button !== 0) return
        // Always-on drawing starts on the image's own button: it keeps focus and its click.
        if (!alwaysDraw) e.preventDefault()
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
      },
      onPointerMove(e) {
        if (drag) setDrag({ ...drag, to: { x: e.clientX, y: e.clientY } })
      },
      onPointerUp(e) {
        if (!drag) return
        const to = { x: e.clientX, y: e.clientY }
        const region = regionFromPoints(drag.box, drag.from, to, minPixels)
        setDrag(null)
        if (region) annotations?.onDraw(region)
        else if (alwaysDraw) annotations?.onClick?.()
      },
      onPointerCancel: () => setDrag(null),
    },
  }
}

/**
 * A transparent layer over a snapshot image (the parent is positioned and exactly as big as the
 * image). Markers are buttons in the annotation colour; with `drawing` (or `alwaysDraw`),
 * dragging draws a rectangle, kept as fractions of the image so it holds at any zoom. The same
 * tool works from the keyboard (`RegionTool`): focus lands on a region in the middle of the
 * image, the arrow keys move it, Shift and the arrow keys resize it, Enter confirms and Escape
 * cancels.
 */
export function RegionLayer({ annotations, gesture }: RegionLayer.Props) {
  const own = useRegionGesture(gesture ? undefined : annotations)
  const live = (gesture ?? own).live
  const { drawing, alwaysDraw = false } = annotations
  const pendingRef = useRef<HTMLSpanElement>(null)

  return (
    <div
      className={styles.layer}
      data-drawing={drawing ? '' : undefined}
      data-always={alwaysDraw ? '' : undefined}
      data-external={gesture ? '' : undefined}
      data-testid="region-layer"
      {...(gesture ? {} : own.bind)}
    >
      {annotations.underlay}
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
          <span aria-hidden="true" className={styles.pin}>
            <span>{t.number}</span>
          </span>
        </button>
      ))}
      {annotations.pending ? (
        <span
          ref={pendingRef}
          className={styles.marker}
          data-pending=""
          style={regionStyle(annotations.pending)}
        />
      ) : null}
      {live ? <span className={styles.marker} data-pending="" style={regionStyle(live)} /> : null}
      {annotations.pending && annotations.composer ? (
        <RegionComposer
          // A new region is a new draft: the box starts empty.
          key={`${annotations.pending.x}:${annotations.pending.y}:${annotations.pending.width}:${annotations.pending.height}`}
          region={annotations.pending}
          anchor={pendingRef}
          {...annotations.composer}
        />
      ) : null}
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
 * A region layer with its own drag handling, filling whatever positioned parent it is put in
 * (the enlarged image in the dialog). The same gesture and markers as the inline images.
 */
export function RegionOverlay({ annotations }: RegionOverlay.Props) {
  const gesture = useRegionGesture(annotations)
  return (
    <div className={styles.overlay} data-testid="region-overlay" {...gesture.bind}>
      <RegionLayer annotations={annotations} gesture={gesture} />
    </div>
  )
}

export namespace RegionOverlay {
  export interface Props {
    annotations: Annotations
  }
}

const NO_MEMBERS: readonly Mention.Member[] = []

/**
 * The comment box for a region that was just selected: 232px wide, below the region with its left
 * edge on the region's, or above it when there is less than 200px of room below. The field has
 * focus on open; @ lists members (Esc closes that list first); Esc cancels, ⌘/Ctrl+Enter sends, and Send waits for some text.
 */
function RegionComposer({
  region,
  anchor,
  onSend,
  onCancel,
  sending = false,
  error,
  author,
  members = NO_MEMBERS,
}: RegionComposer.Props) {
  const [body, setBody] = useState('')
  const [side, setSide] = useState<'below' | 'above'>('below')
  const field = useRef<HTMLTextAreaElement>(null)
  const errorId = useId()
  const text = body.trim()

  // Measuring the region on screen is the one thing a render cannot know: place before paint.
  useLayoutEffect(() => {
    const box = anchor.current?.getBoundingClientRect()
    // oxlint-disable-next-line react/set-state-in-effect
    if (box) setSide(popoverSide(window.innerHeight - box.bottom))
  }, [anchor])

  useEffect(() => {
    field.current?.focus()
  }, [])

  const send = () => {
    if (text !== '' && !sending) onSend(text)
  }

  return (
    <div
      role="dialog"
      aria-label="Comment on this region"
      className={styles.popover}
      data-side={side}
      style={{
        left: `min(${region.x * 100}%, calc(100% - 232px))`,
        ...(side === 'below'
          ? { top: `calc(${(region.y + region.height) * 100}% + 10px)` }
          : { bottom: `calc(${(1 - region.y) * 100}% + 10px)` }),
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault()
          e.stopPropagation()
          onCancel()
        } else if (isSubmitKey(e)) {
          e.preventDefault()
          e.stopPropagation()
          send()
        }
      }}
    >
      <div className={styles.who}>
        {author ? (
          <Avatar type="user" id={author.id} name={author.name} image={author.image} size={20} />
        ) : null}
        <span>Comment on this region</span>
      </div>
      <MentionField
        members={members}
        inputRef={field}
        className={styles.field}
        aria-label="Comment"
        aria-describedby={error ? errorId : undefined}
        placeholder="Leave a comment. @ mentions a member."
        rows={2}
        value={body}
        onChange={setBody}
      />
      {error ? (
        <span id={errorId} role="alert" className={styles.error}>
          {error}
        </span>
      ) : null}
      <div className={styles.actions}>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel <Kbd>Esc</Kbd>
        </Button>
        <Button size="sm" variant="primary" disabled={text === ''} loading={sending} onClick={send}>
          Send <Kbd>⌘↵</Kbd>
        </Button>
      </div>
    </div>
  )
}

export namespace RegionComposer {
  export interface Callbacks {
    /** The trimmed text of the comment. */
    onSend: (body: string) => void
    onCancel: () => void
    sending?: boolean
    error?: string | undefined
    /** Whose avatar heads the popover: the signed-in user. */
    author?: { id: string; name: string; image: string | null } | undefined
    /** Who an @ can mention in the comment. */
    members?: readonly Mention.Member[]
  }

  export interface Props extends Callbacks {
    region: Comment.Region
    /** The marker of the region, to measure the room below it. */
    anchor: RefObject<HTMLElement | null>
  }
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
    /** The drag handlers live on a parent (`useRegionGesture`): the layer only draws. */
    gesture?: Gesture
  }
}
