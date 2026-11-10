/**
 * Every resizable pane of the dashboard: its default width (what the layout was before panes
 * could be dragged), and the smallest and largest width the drag, the keyboard and a stored value
 * are held to. The two navigation panes can also be collapsed.
 */
export const PANES = {
  sidebar: { default: 244, min: 200, max: 360, label: 'sidebar' },
  'settings-nav': { default: 244, min: 200, max: 360, label: 'settings navigation' },
  'build-rail': { default: 240, min: 220, max: 480, label: 'screenshot list' },
  'build-discussion': { default: 340, min: 320, max: 720, label: 'review panel' },
  'reviews-list': { default: 420, min: 320, max: 640, label: 'review list' },
  'inbox-pane': { default: 420, min: 320, max: 720, label: 'notification pane' },
  'triage-pane': { default: 420, min: 320, max: 720, label: 'details pane' },
  'builds-peek': { default: 340, min: 320, max: 720, label: 'preview pane' },
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

/** A stored width, or the default when it is missing or not a number; always within the pane's range. */
export function paneWidth(id: PaneId, stored: unknown): number {
  const { default: fallback, min, max } = PANES[id]
  const n = typeof stored === 'number' && Number.isFinite(stored) ? Math.round(stored) : fallback
  return Math.min(max, Math.max(min, n))
}

export interface PaneSpec {
  default: number
  min: number
  max: number
  /** Names the separator: "Resize the <label>". */
  label: string
}
