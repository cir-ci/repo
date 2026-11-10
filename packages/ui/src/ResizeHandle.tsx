import { type HTMLAttributes, type KeyboardEvent, type PointerEvent, useRef, useState } from 'react'

import { cx } from './cx.ts'

import styles from './ResizeHandle.module.css'

/** Pixels an arrow key moves the line; with Shift, `RESIZE_LARGE_STEP`. */
export const RESIZE_STEP = 16
export const RESIZE_LARGE_STEP = 64
/**
 * How far past the minimum a drag has to go before it collapses a collapsible pane: most of the
 * way to the window's edge, so pulling the sidebar to its narrowest never hides it by accident.
 */
export const COLLAPSE_SLACK = 140

/** `value` kept within `min` and `max`, rounded to whole pixels. */
export function clampSize(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)))
}

/**
 * The line between two columns, draggable: a vertical `separator` (9px hit area, a 1px line)
 * that resizes the pane beside it. Place it with `style={{ left: … }}` in a positioned
 * container (it centres itself on `left`). `edge` says which side of the pane the line is on:
 * `end` for a pane to its left (dragging right grows it), `start` for a pane to its right.
 *
 * It is controlled: `value` is the pane's width in px, `onValueChange` receives the next one,
 * always within `min` and `max`. Pointer drag uses pointer capture; with `cssVar` the drag writes
 * the width into that custom property on the handle's parent each move (one style write, no React
 * render) and calls `onValueChange` once on release; without it, every move calls it. Keyboard:
 * arrows move the line by 16px (Shift 64px), Home and End jump to `min` and `max`, Enter or a
 * double click restores `defaultValue`. `onCollapse` makes a drag past the minimum collapse the pane.
 */
export function ResizeHandle({
  value,
  min,
  max,
  defaultValue,
  onValueChange,
  onCollapse,
  edge = 'end',
  cssVar,
  label,
  className,
  onKeyDown,
  onDoubleClick,
  ...rest
}: ResizeHandle.Props) {
  const ref = useRef<HTMLDivElement>(null)
  const drag = useRef<{ x: number; from: number; last: number } | null>(null)
  const [active, setActive] = useState(false)
  const sign = edge === 'end' ? 1 : -1

  const show = (next: number) => {
    const el = ref.current
    if (!el) return
    el.setAttribute('aria-valuenow', String(next))
    el.setAttribute('aria-valuetext', `${next} pixels`)
    if (cssVar) el.parentElement?.style.setProperty(cssVar, `${next}px`)
  }

  const finish = (event: PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    drag.current = null
    setActive(false)
    try {
      event.currentTarget.releasePointerCapture(event.pointerId)
    } catch {
      // The pointer was already released.
    }
    if (!d || !cssVar) return
    if (d.last === value) show(value)
    else onValueChange(d.last)
  }

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    drag.current = { x: event.clientX, from: value, last: value }
    setActive(true)
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      // Synthetic pointers can't be captured; the drag still follows the events it gets.
    }
    event.preventDefault()
  }

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d) return
    const raw = d.from + sign * (event.clientX - d.x)
    if (onCollapse && raw < min - COLLAPSE_SLACK) {
      drag.current = null
      setActive(false)
      if (cssVar) show(value)
      onCollapse()
      return
    }
    const next = clampSize(raw, min, max)
    if (next === d.last) return
    d.last = next
    if (cssVar) show(next)
    else onValueChange(next)
  }

  const keyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    onKeyDown?.(event)
    if (event.defaultPrevented) return
    const step = event.shiftKey ? RESIZE_LARGE_STEP : RESIZE_STEP
    let next: number | undefined
    if (event.key === 'ArrowRight') next = value + sign * step
    else if (event.key === 'ArrowLeft') next = value - sign * step
    else if (event.key === 'Home') next = min
    else if (event.key === 'End') next = max
    else if (event.key === 'Enter') next = defaultValue
    if (next === undefined) return
    event.preventDefault()
    const clamped = clampSize(next, min, max)
    if (clamped !== value) onValueChange(clamped)
  }

  return (
    <div
      {...rest}
      ref={ref}
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuetext={`${value} pixels`}
      tabIndex={0}
      data-active={active ? '' : undefined}
      className={cx(styles.root, className)}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finish}
      onPointerCancel={finish}
      onKeyDown={keyDown}
      onDoubleClick={(event) => {
        onDoubleClick?.(event)
        if (!event.defaultPrevented && defaultValue !== value) onValueChange(defaultValue)
      }}
    />
  )
}

export namespace ResizeHandle {
  export interface Props extends Omit<
    HTMLAttributes<HTMLDivElement>,
    'role' | 'children' | 'tabIndex' | 'aria-label' | 'aria-orientation'
  > {
    /** The pane's width in px. */
    value: number
    min: number
    max: number
    /** What Enter and a double click restore. */
    defaultValue: number
    /** The next width (within `min` and `max`). */
    onValueChange: (value: number) => void
    /** Called when a drag goes well past `min`; omit for a pane that only resizes. */
    onCollapse?: () => void
    /** Which side of the pane the line is on; `end` (the default) means the pane is to its left. */
    edge?: 'start' | 'end'
    /** A custom property (`--circi-sidebar-width`) set on the parent during a drag. */
    cssVar?: `--${string}`
    /** The separator's name: "Resize the sidebar". */
    label: string
  }
}
