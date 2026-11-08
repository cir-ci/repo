import { useEffect, useRef } from 'react'

import { DESIGN_MODE, VIEW_MODES, type ViewMode } from '#features/builds/search.ts'

/**
 * The one keyboard layer. Every shortcut is declared once in `SHORTCUTS` (keys, scope, group,
 * description, action); the `?` help lists that table. Screens bind behaviour to an action with
 * `useShortcutHandlers`, so a key is never matched anywhere else. One `keydown` listener serves
 * the whole app.
 *
 * Key syntax: `j`, `?`, `mod+k` (⌘ or Ctrl), `mod+shift+c`, and two-key chords with a space: `g i`.
 */

/** Where a shortcut applies: everywhere, in a list of rows, or on the build review screen. */
export type ShortcutScope = 'global' | 'list' | 'inbox' | 'triage' | 'build-review'

export type ShortcutGroup = 'Navigation' | 'General' | 'Lists' | 'Inbox' | 'Triage' | 'Build review'

export type GoTarget = 'inbox' | 'reviews' | 'projects' | 'triage' | 'settings'

export type ShortcutAction =
  | { type: 'next' }
  | { type: 'previous' }
  | { type: 'open' }
  | { type: 'peek' }
  | { type: 'filter' }
  | { type: 'display' }
  | { type: 'select' }
  | { type: 'snooze' }
  | { type: 'requestReview' }
  | { type: 'toggleRead' }
  | { type: 'remove' }
  | { type: 'acceptBaseline' }
  | { type: 'ignoreRegion' }
  | { type: 'assignMe' }
  | { type: 'dismiss' }
  | { type: 'approve' }
  | { type: 'reject' }
  | { type: 'comment' }
  | { type: 'submit' }
  | { type: 'help' }
  | { type: 'command' }
  | { type: 'copyLink' }
  | { type: 'go'; to: GoTarget }
  | { type: 'mode'; mode: ViewMode }

export interface Shortcut {
  key: string
  scope: ShortcutScope
  group: ShortcutGroup
  description: string
  action: ShortcutAction
}

const MODE_NAME: Record<ViewMode, string> = {
  side: 'Side by side',
  overlay: 'Overlay',
  diff: 'Diff',
  swipe: 'Swipe',
  design: 'Design',
}

export const MODE_OPTIONS = VIEW_MODES.map((value) => ({ value, label: MODE_NAME[value] }))

const GO: readonly [string, GoTarget, string][] = [
  ['g i', 'inbox', 'Go to Inbox'],
  ['g r', 'reviews', 'Go to Reviews'],
  ['g p', 'projects', 'Go to Projects'],
  ['g t', 'triage', 'Go to Triage'],
  ['g s', 'settings', 'Go to Settings'],
]

/** Every keyboard shortcut of the app, in the order the help lists them. */
export const SHORTCUTS: readonly Shortcut[] = [
  ...GO.map(([key, to, description]): Shortcut => ({
    key,
    scope: 'global',
    group: 'Navigation',
    description,
    action: { type: 'go', to },
  })),
  {
    key: 'mod+k',
    scope: 'global',
    group: 'General',
    description: 'Open the command menu',
    action: { type: 'command' },
  },
  {
    key: 'mod+shift+c',
    scope: 'global',
    group: 'General',
    description: 'Copy link to this page',
    action: { type: 'copyLink' },
  },
  {
    key: '?',
    scope: 'global',
    group: 'General',
    description: 'Show this list',
    action: { type: 'help' },
  },
  {
    key: 'j',
    scope: 'list',
    group: 'Lists',
    description: 'Next item',
    action: { type: 'next' },
  },
  {
    key: 'k',
    scope: 'list',
    group: 'Lists',
    description: 'Previous item',
    action: { type: 'previous' },
  },
  {
    key: 'Enter',
    scope: 'list',
    group: 'Lists',
    description: 'Open',
    action: { type: 'open' },
  },
  {
    key: 'space',
    scope: 'list',
    group: 'Lists',
    description: 'Peek at the item',
    action: { type: 'peek' },
  },
  {
    key: 'f',
    scope: 'list',
    group: 'Lists',
    description: 'Filter the list',
    action: { type: 'filter' },
  },
  {
    key: 'shift+v',
    scope: 'list',
    group: 'Lists',
    description: 'Display options',
    action: { type: 'display' },
  },
  {
    key: 'x',
    scope: 'list',
    group: 'Lists',
    description: 'Select or deselect the item',
    action: { type: 'select' },
  },
  {
    key: 'h',
    scope: 'list',
    group: 'Lists',
    description: 'Snooze',
    action: { type: 'snooze' },
  },
  {
    key: 'shift+r',
    scope: 'list',
    group: 'Lists',
    description: 'Request review',
    action: { type: 'requestReview' },
  },
  {
    key: 'u',
    scope: 'inbox',
    group: 'Inbox',
    description: 'Mark read or unread',
    action: { type: 'toggleRead' },
  },
  {
    key: 'Backspace',
    scope: 'inbox',
    group: 'Inbox',
    description: 'Delete the notification',
    action: { type: 'remove' },
  },
  {
    key: 'b',
    scope: 'triage',
    group: 'Triage',
    description: 'Accept as baseline',
    action: { type: 'acceptBaseline' },
  },
  {
    key: 'i',
    scope: 'triage',
    group: 'Triage',
    description: 'Add an ignore region',
    action: { type: 'ignoreRegion' },
  },
  {
    key: 'm',
    scope: 'triage',
    group: 'Triage',
    description: 'Assign to me',
    action: { type: 'assignMe' },
  },
  {
    key: 'd',
    scope: 'triage',
    group: 'Triage',
    description: 'Dismiss',
    action: { type: 'dismiss' },
  },
  {
    key: 'a',
    scope: 'build-review',
    group: 'Build review',
    description: 'Approve all changes',
    action: { type: 'approve' },
  },
  {
    key: 'r',
    scope: 'build-review',
    group: 'Build review',
    description: 'Reject the build, with a reason',
    action: { type: 'reject' },
  },
  {
    key: 'c',
    scope: 'build-review',
    group: 'Build review',
    description: 'Write a comment',
    action: { type: 'comment' },
  },
  {
    key: 'mod+Enter',
    scope: 'build-review',
    group: 'Build review',
    description: 'Send the comment or confirm the dialog you are typing in',
    action: { type: 'submit' },
  },
  ...VIEW_MODES.map((mode, i): Shortcut => ({
    key: String(i + 1),
    scope: 'build-review',
    group: 'Build review',
    description: MODE_NAME[mode],
    action: { type: 'mode', mode },
  })),
  {
    key: String(VIEW_MODES.length + 1),
    scope: 'build-review',
    group: 'Build review',
    description: MODE_NAME[DESIGN_MODE],
    action: { type: 'mode', mode: DESIGN_MODE },
  },
]

/** Whether the help lists and the screen honours a shortcut: the Design mode needs the integration. */
export const isAvailable = (s: Shortcut, designEnabled: boolean) =>
  designEnabled || s.action.type !== 'mode' || s.action.mode !== DESIGN_MODE

/** Whether a key press is ⌘↵ / Ctrl+↵, which sends a comment or confirms a dialog from its text field. */
export const isSubmitKey = (
  e: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>,
) => keyToken(e) === 'mod+Enter'

export const shortcutFor = (key: string): Shortcut | undefined =>
  SHORTCUTS.find((s) => s.key === key)

/** The shortcuts under their group headings, for the help dialog. */
export function shortcutGroups(
  designEnabled = false,
): { group: ShortcutGroup; shortcuts: Shortcut[] }[] {
  const groups: { group: ShortcutGroup; shortcuts: Shortcut[] }[] = []
  for (const shortcut of SHORTCUTS) {
    if (!isAvailable(shortcut, designEnabled)) continue
    const found = groups.find((g) => g.group === shortcut.group)
    if (found) found.shortcuts.push(shortcut)
    else groups.push({ group: shortcut.group, shortcuts: [shortcut] })
  }
  return groups
}

const KEY_LABEL: Record<string, string> = {
  mod: '⌘',
  shift: '⇧',
  Enter: '↵',
  Backspace: '⌫',
  space: 'Space',
}

/** The caps to draw for a key spec: `mod+shift+c` is ⌘ ⇧ C, `g i` is G I. */
export function keyCaps(key: string): string[] {
  return key
    .split(/[\s+]/)
    .filter(Boolean)
    .map((part) => KEY_LABEL[part] ?? part.toUpperCase())
}

/** What a key press is called in `SHORTCUTS`, or undefined for a press that is never a shortcut (Alt). */
export function keyToken(
  event: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>,
): string | undefined {
  if (event.altKey) return undefined
  const key =
    event.key === ' ' ? 'space' : event.key.length === 1 ? event.key.toLowerCase() : event.key
  const mod = event.metaKey || event.ctrlKey
  // Shift only tells keys apart when it is not what makes the character (`?`, `A`).
  const shift = event.shiftKey && (mod || /^[a-z]$/.test(key))
  return [mod ? 'mod' : '', shift ? 'shift' : '', key].filter(Boolean).join('+')
}

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

/** How long after a chord's first key (`g`) its second one still counts. */
const CHORD_MS = 1000

/** The handler for each action type; `useShortcutHandlers` binds them. */
export type ShortcutHandlers = {
  [A in ShortcutAction as A['type']]?: (action: A, event: KeyboardEvent) => void | false
}

const bound: { current: ShortcutHandlers }[] = []
let pending: { prefix: string; at: number } | undefined

function run(shortcut: Shortcut, event: KeyboardEvent): boolean {
  const type = shortcut.action.type
  for (const entry of bound.toReversed()) {
    // Handlers are keyed by the action's own type, so this one takes exactly this action.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    const handler = entry.current[type] as
      | ((action: ShortcutAction, event: KeyboardEvent) => void | false)
      | undefined
    if (!handler) continue
    // A handler that returns `false` leaves the key to the browser (Enter on a focused link).
    if (handler(shortcut.action, event) !== false) event.preventDefault()
    return true
  }
  return false
}

/** Matches a key press against `SHORTCUTS` (with chord state) and runs the newest handler for it. */
export function handleKeydown(event: KeyboardEvent, now = Date.now()): void {
  const token = keyToken(event)
  if (token === undefined) return
  // A shortcut with ⌘/Ctrl is meant to work anywhere; the rest leave typing and dialogs alone.
  if (!token.startsWith('mod+') && isHandledElsewhere(event.target, event)) return
  const chord = pending && now - pending.at <= CHORD_MS ? `${pending.prefix} ${token}` : undefined
  pending = undefined
  const second = chord ? shortcutFor(chord) : undefined
  if (second) {
    run(second, event)
    return
  }
  const shortcut = shortcutFor(token)
  if (shortcut) {
    run(shortcut, event)
    return
  }
  if (SHORTCUTS.some((s) => s.key.startsWith(`${token} `))) pending = { prefix: token, at: now }
}

/** Test seam: forget a half-typed chord. */
export function resetChord(): void {
  pending = undefined
}

/**
 * Binds behaviour to shortcut actions while the component is mounted. The newest binding of an
 * action wins, so a screen can take over a global key (the review screen's own `?` list).
 */
export function useShortcutHandlers(handlers: ShortcutHandlers): void {
  const ref = useRef(handlers)
  useEffect(() => {
    ref.current = handlers
  })
  useEffect(() => {
    if (bound.length === 0) window.addEventListener('keydown', handleKeydown)
    bound.push(ref)
    return () => {
      bound.splice(bound.indexOf(ref), 1)
      if (bound.length === 0) window.removeEventListener('keydown', handleKeydown)
    }
  }, [])
}
