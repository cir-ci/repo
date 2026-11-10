import { ResizeHandle } from '@circi/ui'
import type { CSSProperties } from 'react'

import { type PaneId, PANES } from '#lib/panes.ts'
import { usePaneStore, usePaneWidth } from '#lib/stores/pane-store.ts'

/**
 * The drag handle of one pane (`PANES`): `ResizeHandle` wired to the pane store, so the width is
 * kept per pane in this browser. The pane's container sets the width from `usePaneWidth(pane)` into
 * `cssVar` and is the handle's positioned parent; `at` is the handle's `left` (a CSS length).
 */
export function PaneHandle({ pane, cssVar, at, edge = 'end', onCollapse }: PaneHandle.Props) {
  const width = usePaneWidth(pane)
  const setWidth = usePaneStore((s) => s.setWidth)
  const spec = PANES[pane]
  return (
    <ResizeHandle
      label={`Resize the ${spec.label}`}
      value={width}
      min={spec.min}
      max={spec.max}
      defaultValue={spec.default}
      edge={edge}
      cssVar={cssVar}
      style={{ left: at }}
      data-pane={pane}
      onValueChange={(next) => setWidth(pane, next)}
      {...(onCollapse ? { onCollapse } : {})}
    />
  )
}

/** A container's style with each pane's width (px) in its custom property: `paneVars({ '--circi-pane-width': width })`. */
export function paneVars(vars: Record<`--${string}`, number>): CSSProperties {
  return Object.fromEntries(Object.entries(vars).map(([k, v]) => [k, `${v}px`]))
}

export namespace PaneHandle {
  export interface Props {
    pane: PaneId
    /** The custom property the pane's container sets to the width, e.g. `--circi-pane-width`. */
    cssVar: `--${string}`
    /** The handle's `left` within the container: where the line between the two columns is. */
    at: string
    edge?: 'start' | 'end'
    onCollapse?: () => void
  }
}
