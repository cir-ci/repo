/**
 * Every resizable pane of the dashboard, and the one rule that holds its width to the space there
 * is. A pane has a default width (what the layout was before panes could be dragged), an absolute
 * range (`min`, `max`: px) and two limits relative to its container:
 *
 * - `maxShare`: the pane takes at most this share of the container (0.5: half of a split).
 * - `minMain`: the space (px, gaps and padding included) the content beside the pane keeps.
 *
 * The effective range in a container `C` px wide is
 *
 *     hi = max(0, min(max, floor(C * maxShare), C - minMain))
 *     lo = min(min, hi)               // the minimum gives way where it can't fit
 *
 * and a stored width renders as `clamp(lo, stored, hi)`: the upper limit always wins, so a pane
 * never forces horizontal overflow. The stored width itself is only held to `min`..`max`
 * (`paneWidth`), so a 720px pane dragged on a wide screen comes back when the window grows again.
 *
 * The rule is written twice from this one table: `paneLimits` / `paneRendered` for the handle
 * (aria-valuemin/max/now, drag and keys) and `paneWidthCss` for the CSS (`min()`/`max()` with
 * percentages, set into the container's custom property), so the rendered width and what the
 * handle reports agree and the window shrinks the pane live without JS. The container is the
 * element the percentages resolve against: the pane's split, the build page's grid, and for the
 * navigation panes the app frame (the viewport).
 */
export const PANES = {
  sidebar: {
    default: 244,
    min: 200,
    max: 360,
    maxShare: 0.3,
    minMain: 400,
    label: 'sidebar',
  },
  'settings-nav': {
    default: 244,
    min: 200,
    max: 360,
    maxShare: 0.3,
    minMain: 400,
    label: 'settings navigation',
  },
  // The build page's grid is list | viewer | review panel. The viewer keeps 360px or more with
  // both panes at their limits (list 24% + panel 35%, or the panel at C - 580 below 890px).
  'build-rail': {
    default: 240,
    min: 220,
    max: 480,
    maxShare: 0.24,
    minMain: 360,
    label: 'screenshot list',
  },
  'build-discussion': {
    default: 340,
    min: 320,
    max: 720,
    maxShare: 0.35,
    minMain: 580,
    label: 'review panel',
  },
  'reviews-list': {
    default: 420,
    min: 320,
    max: 640,
    maxShare: 0.5,
    minMain: 380,
    label: 'review list',
  },
  'inbox-pane': {
    default: 420,
    min: 320,
    max: 720,
    maxShare: 0.5,
    minMain: 380,
    label: 'notification pane',
  },
  'triage-pane': {
    default: 420,
    min: 320,
    max: 720,
    maxShare: 0.5,
    minMain: 380,
    label: 'details pane',
  },
  'builds-peek': {
    default: 340,
    min: 320,
    max: 720,
    maxShare: 0.5,
    minMain: 380,
    label: 'preview pane',
  },
} as const satisfies Record<string, PaneSpec>

export type PaneId = keyof typeof PANES

/** Every pane id. */
export const PANE_IDS = [
  'sidebar',
  'settings-nav',
  'build-rail',
  'build-discussion',
  'reviews-list',
  'inbox-pane',
  'triage-pane',
  'builds-peek',
] as const satisfies readonly PaneId[]

/** The panes that collapse completely. */
export type NavPaneId = 'sidebar' | 'settings-nav'

/** A stored width, or the default when it is missing or not a number; always within the pane's absolute range. */
export function paneWidth(id: PaneId, stored: unknown): number {
  const { default: fallback, min, max } = PANES[id]
  const n = typeof stored === 'number' && Number.isFinite(stored) ? Math.round(stored) : fallback
  return Math.min(max, Math.max(min, n))
}

/** The smallest and largest width the pane can have in a container `container` px wide (the rule above). */
export function paneLimits(id: PaneId, container: number): { min: number; max: number } {
  const spec: PaneSpec = PANES[id]
  const max = Math.max(
    0,
    Math.min(spec.max, Math.floor(container * spec.maxShare), Math.floor(container - spec.minMain)),
  )
  return { min: Math.min(spec.min, max), max }
}

/** The width a stored one renders at in a container `container` px wide: what the CSS computes. */
export function paneRendered(id: PaneId, stored: number, container: number): number {
  const { min, max } = paneLimits(id, container)
  return Math.min(max, Math.max(min, stored))
}

/**
 * The CSS length that renders a stored width under the same rule, for the pane's custom property.
 * Its percentages resolve against the container where the property is used, so it follows the
 * window without JS.
 */
export function paneWidthCss(id: PaneId, stored: number): string {
  const spec: PaneSpec = PANES[id]
  const share = Math.round(spec.maxShare * 10_000) / 100
  const hi = `max(0px, min(${spec.max}px, ${share}%, 100% - ${spec.minMain}px))`
  return `min(max(${spec.min}px, ${stored}px), ${hi})`
}

export interface PaneSpec {
  default: number
  /** The smallest width of a drag, the keyboard or a stored value (it gives way in a small container). */
  min: number
  /** The largest width, whatever the container. */
  max: number
  /** The largest share of the container (0 to 1). */
  maxShare: number
  /** The space the content beside the pane keeps, in px (the gap included). */
  minMain: number
  /** Names the separator: "Resize the <label>". */
  label: string
}
