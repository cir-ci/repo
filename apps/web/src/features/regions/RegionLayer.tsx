import type { Comment, IgnoreRegion } from '@circi/api'
import { Avatar, Button, Kbd, Popover, PopoverClose, useAnnounce, visuallyHidden } from '@circi/ui'
import {
  type KeyboardEvent,
  type PointerEvent,
  type RefObject,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react'

import { MentionField } from '#lib/MentionField.tsx'
import type { Mention } from '#lib/mentions.ts'
import { isSubmitKey } from '#lib/shortcuts.ts'

import { withScrolled } from './auto-scroll.ts'
import {
  type Box,
  describeRegion,
  MIN_REGION_PX,
  nudgeRegion,
  type Point,
  regionFromPoints,
  regionStyle,
  START_REGION,
} from './geometry.ts'
import type { Size } from './ignore-regions.ts'
import { type Adjust, RegionHandles, useAdjustable } from './RegionAdjust.tsx'
import { RegionBoxes } from './RegionBoxes.tsx'
import { useAutoScroll } from './use-auto-scroll.ts'

import styles from './RegionLayer.module.css'

/** The comment regions of the snapshot on screen, and what drawing a new one needs. */
export interface Annotations {
  /** Pinned threads of this snapshot, numbered like their cards in the Comments tab. */
  threads: {
    id: string
    number: number
    region: Comment.Region
    /** The signed-in person may move and resize it (its author): it gets corner handles. */
    adjustable?: boolean
  }[]
  /** The region drawn and not yet sent. */
  pending: Comment.Region | null
  /** Tells one draft from the next (the comment box starts empty for a new one, not for a moved one). */
  pendingKey?: string | number
  /** Moving or resizing the pending region by dragging it is allowed: the new region. */
  onAdjustPending?: (region: Comment.Region) => void
  /** A thread's region was moved or resized by dragging (only `adjustable` ones can be). */
  onAdjust?: (id: string, region: Comment.Region) => void | Promise<unknown>
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
  /**
   * Drawn under the markers: the ignore regions shown while a drag draws one. With `onAdjust`
   * they can be moved and resized too (owners and admins).
   */
  ignoreRegions?: {
    regions: readonly IgnoreRegion.Item[]
    size: Size
    onAdjust?: RegionBoxes.Props['onAdjust']
  }
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
  // Near an edge of the scroll area the drag scrolls it; the pointer is then measured in the
  // coordinates of the press (`box` was read once), so the region's edge stays under it.
  const auto = useAutoScroll()
  const stopAuto = auto.stop

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

  return {
    live: drag
      ? regionFromPoints(drag.box, drag.from, withScrolled(drag.to, auto.scrolled), minPixels)
      : null,
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
        auto.start(e.currentTarget, at)
      },
      onPointerMove(e) {
        if (!drag) return
        const to = { x: e.clientX, y: e.clientY }
        auto.move(to)
        setDrag({ ...drag, to })
      },
      onPointerUp(e) {
        if (!drag) return
        const to = withScrolled({ x: e.clientX, y: e.clientY }, auto.read())
        const region = regionFromPoints(drag.box, drag.from, to, minPixels)
        auto.stop()
        setDrag(null)
        if (region) annotations?.onDraw(region)
        else if (alwaysDraw) annotations?.onClick?.()
      },
      onPointerCancel: () => {
        auto.stop()
        setDrag(null)
      },
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
  const onAdjustPending = annotations.onAdjustPending
  // Whether the comment box has nothing typed (it says so as it changes; a new draft starts empty).
  const composerEmpty = useRef(true)
  // Clicking the selected region again with nothing typed drops the draft: the region and the box
  // close, as a click outside the box does. With text typed it stays, so nothing is lost.
  const dropIfEmpty = () => {
    if (annotations.composer && composerEmpty.current) annotations.composer.onCancel()
  }
  // The draft can be dragged about before it is sent; the comment box follows it. A press that
  // never becomes a drag is a click.
  const pendingBox = useAdjustable(
    annotations.pending ?? START_REGION,
    onAdjustPending ? { onCommit: onAdjustPending, onClick: dropIfEmpty } : undefined,
  )
  // Not draggable: the click is the region's own (and the layer under it mustn't start a new one).
  const pendingClick =
    !onAdjustPending && annotations.composer
      ? {
          onPointerDown: (e: PointerEvent<HTMLElement>) => e.stopPropagation(),
          onClick: dropIfEmpty,
        }
      : {}

  return (
    <div
      className={styles.layer}
      data-drawing={drawing ? '' : undefined}
      data-always={alwaysDraw ? '' : undefined}
      data-external={gesture ? '' : undefined}
      data-testid="region-layer"
      {...(gesture ? {} : own.bind)}
    >
      {annotations.ignoreRegions ? (
        <RegionBoxes {...annotations.ignoreRegions} onClick={annotations.onClick} />
      ) : null}
      {annotations.threads.map((t) => (
        <ThreadMarker
          key={t.id}
          thread={t}
          focused={t.id === annotations.focusedId}
          onMarker={annotations.onMarker}
          adjust={
            t.adjustable && annotations.onAdjust
              ? { onCommit: (region) => annotations.onAdjust?.(t.id, region) }
              : undefined
          }
        />
      ))}
      {annotations.pending ? (
        <span
          ref={pendingRef}
          className={styles.marker}
          data-pending=""
          style={regionStyle(pendingBox.region)}
          {...pendingBox.props}
          {...pendingClick}
        >
          {annotations.onAdjustPending ? <RegionHandles /> : null}
        </span>
      ) : null}
      {live ? <span className={styles.marker} data-pending="" style={regionStyle(live)} /> : null}
      {annotations.pending && annotations.composer ? (
        <RegionComposer
          // A new region is a new draft: the box starts empty.
          key={
            annotations.pendingKey ??
            `${annotations.pending.x}:${annotations.pending.y}:${annotations.pending.width}:${annotations.pending.height}`
          }
          anchor={pendingRef}
          moved={`${pendingBox.region.x}:${pendingBox.region.y}:${pendingBox.region.width}:${pendingBox.region.height}`}
          onEmptyChange={(empty) => {
            composerEmpty.current = empty
          }}
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

/** A saved thread's region: a button in the annotation colour with its pin, and corner handles for its author. */
function ThreadMarker({ thread, focused, onMarker, adjust }: ThreadMarker.Props) {
  const box = useAdjustable(thread.region, adjust)
  return (
    <button
      type="button"
      className={styles.marker}
      style={regionStyle(box.region)}
      data-focused={focused ? '' : undefined}
      aria-label={`Comment ${thread.number}`}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={() => onMarker(thread.id)}
      {...box.props}
    >
      <span aria-hidden="true" className={styles.pin}>
        <span>{thread.number}</span>
      </span>
      {adjust ? <RegionHandles /> : null}
    </button>
  )
}

namespace ThreadMarker {
  export interface Props {
    thread: Annotations['threads'][number]
    focused: boolean
    onMarker: (id: string) => void
    adjust: Adjust | undefined
  }
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
 * The comment box for a region that was just selected: a `Popover` 232px wide anchored to the
 * region's marker, below it with its left edge on the region's, flipping above (and shifting along
 * the edge) when there is no room. The field has focus on open and Tab stays inside the box;
 * closing returns focus to where it was. @ lists members (Esc closes that list first); Esc or
 * Cancel cancels, ⌘/Ctrl+Enter sends, and Send waits for some text. A click outside dismisses the
 * box while it's empty (nothing typed means nothing to lose); with text in it, it stays until
 * Cancel or Esc.
 */
function RegionComposer({
  anchor,
  onSend,
  onCancel,
  sending = false,
  error,
  author,
  members = NO_MEMBERS,
  onEmptyChange,
  moved,
}: RegionComposer.Props) {
  const [body, setBody] = useState('')
  const field = useRef<HTMLTextAreaElement>(null)
  // The region was dragged somewhere new: typing goes on in the box, as it did before the drag.
  const firstPlace = useRef(moved)
  useEffect(() => {
    if (moved !== firstPlace.current) field.current?.focus()
  }, [moved])
  const text = body.trim()
  const empty = text === '' && !sending
  useEffect(() => onEmptyChange?.(empty), [empty, onEmptyChange])

  const send = () => {
    if (text !== '' && !sending) onSend(text)
  }

  return (
    <Popover
      open
      modal="trap-focus"
      label="Comment on this region"
      anchor={anchor}
      sideOffset={10}
      arrow
      initialFocus={field}
      className={styles.popover}
      onOpenChange={(open, details) => {
        if (open || details.reason === 'focus-out') return
        if (details.reason === 'outside-press') {
          // A press on the region itself is not outside: it starts a drag that moves the region
          // (the box follows), and a plain click on it is answered by the region (RegionLayer).
          const target = details.event.target
          if (target instanceof Node && anchor.current?.contains(target)) return
          if (!empty) return
        }
        onCancel()
      }}
      popupProps={{
        // The layer under the box starts a drag on a pointer press: not one inside the box.
        onPointerDown: (e) => e.stopPropagation(),
        onKeyDown: (e) => {
          if (isSubmitKey(e)) {
            e.preventDefault()
            e.stopPropagation()
            send()
          }
        },
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
        label="Comment"
        hideLabel
        error={error}
        placeholder="Leave a comment. @ mentions a member."
        rows={2}
        value={body}
        onChange={setBody}
      />
      <div className={styles.actions}>
        <PopoverClose size="sm" variant="ghost">
          Cancel <Kbd>Esc</Kbd>
        </PopoverClose>
        <Button size="sm" variant="primary" disabled={text === ''} loading={sending} onClick={send}>
          Send <Kbd>⌘↵</Kbd>
        </Button>
      </div>
    </Popover>
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
    /** The marker of the region: the box points at it. */
    anchor: RefObject<HTMLElement | null>
    /** Told whether nothing is typed, as that changes: a click on the region drops an empty draft. */
    onEmptyChange?: (empty: boolean) => void
    /** Where the region is now: when a drag moves it, the field takes focus back. */
    moved?: string
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
      announce('Region canceled')
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
