import { ResizeHandle } from '@circi/ui'
import { type CSSProperties, useLayoutEffect, useState } from 'react'

import { type PaneId, paneLimits, PANES, paneRendered, paneWidthCss } from '#lib/panes.ts'
import { usePaneStore, usePaneWidth } from '#lib/stores/pane-store.ts'

/**
 * The drag handle of one pane (`PANES`): `ResizeHandle` wired to the pane store, so the width is
 * kept per pane in this browser. The pane's container sets the width from `paneVars` into
 * `cssVar` and is the handle's positioned parent; `at` is the handle's `left` (a CSS length).
 *
 * The container's width (measured, and followed with a ResizeObserver) gives the pane's limits
 * (see `PANES`): the handle reports and drags within them, and `aria-valuenow` is the width that
 * is rendered, which can be less than the stored one. The stored width is only written by a drag
 * or a key. `container` finds the element the pane's percentages resolve against; by default the
 * handle's parent.
 */
export function PaneHandle({
  pane,
  cssVar,
  at,
  edge = 'end',
  container,
  onCollapse,
}: PaneHandle.Props) {
  const stored = usePaneWidth(pane)
  const setWidth = usePaneStore((s) => s.setWidth)
  const spec = PANES[pane]
  const [handle, setHandle] = useState<HTMLElement | null>(null)
  const size = useContainerWidth(handle, container)
  const limits = size === undefined ? { min: spec.min, max: spec.max } : paneLimits(pane, size)
  const width = size === undefined ? stored : paneRendered(pane, stored, size)
  return (
    <ResizeHandle
      ref={setHandle}
      label={`Resize the ${spec.label}`}
      value={width}
      min={limits.min}
      max={limits.max}
      defaultValue={Math.min(limits.max, Math.max(limits.min, spec.default))}
      edge={edge}
      cssVar={cssVar}
      style={{ left: at }}
      data-pane={pane}
      onValueChange={(next) => setWidth(pane, next)}
      {...(onCollapse ? { onCollapse } : {})}
    />
  )
}

/** The width of the handle's container (its parent unless `of` says otherwise), kept up to date; undefined before it is measured. */
function useContainerWidth(
  handle: HTMLElement | null,
  of: ((handle: HTMLElement) => HTMLElement | null | undefined) | undefined,
): number | undefined {
  const [size, setSize] = useState<number | undefined>(undefined)
  useLayoutEffect(() => {
    const el = handle ? (of ? of(handle) : handle.parentElement) : null
    if (!el) return undefined
    const measure = () => setSize(Math.floor(el.getBoundingClientRect().width))
    measure()
    if (typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [handle, of])
  return size
}

/**
 * A container's style with each pane's width in its custom property, rendered under the pane's
 * limits (see `paneWidthCss`): `paneVars({ '--circi-pane-width': ['triage-pane', width] })`.
 */
export function paneVars(vars: Record<`--${string}`, readonly [PaneId, number]>): CSSProperties {
  return Object.fromEntries(
    Object.entries(vars).map(([name, [pane, width]]) => [name, paneWidthCss(pane, width)]),
  )
}

export namespace PaneHandle {
  export interface Props {
    pane: PaneId
    /** The custom property the pane's container sets to the width, e.g. `--circi-pane-width`. */
    cssVar: `--${string}`
    /** The handle's `left` within the container: where the line between the two columns is. */
    at: string
    edge?: 'start' | 'end'
    /** The element the pane's percentages resolve against, when it isn't the handle's parent (a stable function). */
    container?: (handle: HTMLElement) => HTMLElement | null | undefined
    onCollapse?: () => void
  }
}
