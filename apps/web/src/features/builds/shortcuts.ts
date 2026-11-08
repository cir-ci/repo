import { VIEW_MODES, type ViewMode } from './search.ts'

export type ShortcutAction =
  | { type: 'next' }
  | { type: 'previous' }
  | { type: 'approve' }
  | { type: 'reject' }
  | { type: 'help' }
  | { type: 'mode'; mode: ViewMode }

export interface Shortcut {
  key: string
  description: string
  action: ShortcutAction
}

const MODE_NAME: Record<ViewMode, string> = {
  side: 'Side by side',
  overlay: 'Overlay',
  diff: 'Diff',
  swipe: 'Swipe',
}

export const MODE_OPTIONS = VIEW_MODES.map((value) => ({ value, label: MODE_NAME[value] }))

/** Every keyboard shortcut of the review screen; the help dialog lists these. */
export const SHORTCUTS: readonly Shortcut[] = [
  { key: 'j', description: 'Next screenshot', action: { type: 'next' } },
  { key: 'k', description: 'Previous screenshot', action: { type: 'previous' } },
  { key: 'a', description: 'Approve all changes', action: { type: 'approve' } },
  { key: 'r', description: 'Reject the build', action: { type: 'reject' } },
  ...VIEW_MODES.map((mode, i) => ({
    key: String(i + 1),
    description: MODE_NAME[mode],
    action: { type: 'mode', mode } as const,
  })),
  { key: '?', description: 'Show this list', action: { type: 'help' } },
]

export const shortcutFor = (key: string): Shortcut | undefined =>
  SHORTCUTS.find((s) => s.key === key)

/** Keys typed into a field, or inside a dialog, belong to that; so do ones with a modifier. */
export function isHandledElsewhere(
  target: EventTarget | null,
  event: Pick<KeyboardEvent, 'metaKey' | 'ctrlKey' | 'altKey'>,
): boolean {
  if (event.metaKey || event.ctrlKey || event.altKey) return true
  if (!(target instanceof Element)) return false
  if (target.closest('input, textarea, select, [contenteditable="true"]')) return true
  return target.closest('[role="dialog"], [role="alertdialog"]') !== null
}
