import { useEffect, useRef } from 'react'

import { DESIGN_MODE, VIEW_MODES, type ViewMode } from '#features/builds/search.ts'
import { useShortcutStore } from '#lib/stores/shortcut-store.ts'

/**
 * The one keyboard layer. Every shortcut is declared once in `SHORTCUTS` (keys, scope, group,
 * description, action); the `?` help lists that table. Screens bind behaviour to an action with
 * `useShortcutHandlers`, so a key is never matched anywhere else. One `keydown` listener serves
 * the whole app.
 *
 * Key syntax: `j`, `?`, `mod+k` (⌘ or Ctrl), `mod+shift+c`, and two-key chords with a space: `g i`.
 */

export interface Shortcut {
  key: string
  scope: Shortcut.Scope
  group: Shortcut.Group
  description: string
  action: Shortcut.Action
}

export namespace Shortcut {
  /** Where a shortcut applies: everywhere, in a list of rows, or on the build review screen. */
  export type Scope = 'global' | 'list' | 'inbox' | 'triage' | 'build-review'

  export type Group = 'General' | 'Navigation' | 'Lists' | 'Inbox' | 'Build review' | 'Triage'

  export type GoTarget = 'inbox' | 'reviews' | 'teams' | 'triage' | 'settings'

  export type Action =
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
    | { type: 'approveAll' }
    | { type: 'reject' }
    | { type: 'comment' }
    | { type: 'submit' }
    | { type: 'help' }
    | { type: 'command' }
    | { type: 'copyLink' }
    | { type: 'go'; to: GoTarget }
    | { type: 'mode'; mode: ViewMode }

  /** The handler for each action type; `useShortcutHandlers` binds them. */
  export type Handlers = {
    [A in Action as A['type']]?: (action: A, event: KeyboardEvent) => void | false
  }
}

const MODE_NAME: Record<ViewMode, string> = {
  side: 'Side by side',
  overlay: 'Overlay',
  diff: 'Diff',
  slider: 'Slider',
  design: 'Design',
}

export const MODE_OPTIONS = VIEW_MODES.map((value) => ({ value, label: MODE_NAME[value] }))

const GO: readonly [string, Shortcut.GoTarget, string][] = [
  ['g i', 'inbox', 'Go to Inbox'],
  ['g r', 'reviews', 'Go to Reviews'],
  ['g p', 'teams', 'Go to Teams'],
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
    description: 'Approve snapshot',
    action: { type: 'approve' },
  },
  {
    key: 'shift+a',
    scope: 'build-review',
    group: 'Build review',
    description: 'Approve all',
    action: { type: 'approveAll' },
  },
  {
    key: 'r',
    scope: 'build-review',
    group: 'Build review',
    description: 'Reject snapshot, with a reason',
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

/** The groups in the order the help and the shortcuts page show them: every `Shortcut.Group`, once. */
export const GROUP_ORDER: readonly Shortcut.Group[] = [
  'General',
  'Navigation',
  'Lists',
  'Inbox',
  'Build review',
  'Triage',
]

/** The shortcuts under their group headings in `GROUP_ORDER`, for the help dialog and the page. */
export function shortcutGroups(
  designEnabled = false,
): { group: Shortcut.Group; shortcuts: Shortcut[] }[] {
  const groups: { group: Shortcut.Group; shortcuts: Shortcut[] }[] = []
  for (const shortcut of SHORTCUTS) {
    if (!isAvailable(shortcut, designEnabled)) continue
    const found = groups.find((g) => g.group === shortcut.group)
    if (found) found.shortcuts.push(shortcut)
    else groups.push({ group: shortcut.group, shortcuts: [shortcut] })
  }
  return groups.toSorted((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group))
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

/** Anything a person types into: fields, selects, any contenteditable and the text-entry roles. */
const EDITABLE =
  'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="combobox"], [role="searchbox"]'

/** Whether typing here edits text, so every plain key (and every letter) is the writer's. */
export function isEditable(el: Element): boolean {
  return (el instanceof HTMLElement && el.isContentEditable) || el.closest(EDITABLE) !== null
}

/**
 * Keys typed into a field, or inside a dialog, belong to that; so do ones with a modifier. A key
 * sent to the window (not to an element) is judged by the focused element.
 */
export function isHandledElsewhere(
  target: EventTarget | null,
  event: Pick<KeyboardEvent, 'metaKey' | 'ctrlKey' | 'altKey'>,
): boolean {
  if (event.metaKey || event.ctrlKey || event.altKey) return true
  const where =
    typeof Element !== 'undefined' && target instanceof Element
      ? target
      : typeof document === 'undefined'
        ? null
        : document.activeElement
  if (!where) return false
  if (isEditable(where)) return true
  return where.closest('[role="dialog"], [role="alertdialog"]') !== null
}

/** How long after a chord's first key (`g`) its second one still counts. */
const CHORD_MS = 1000

function run(shortcut: Shortcut, event: KeyboardEvent): boolean {
  const type = shortcut.action.type
  for (const entry of useShortcutStore.getState().bindings.toReversed()) {
    // Handlers are keyed by the action's own type, so this one takes exactly this action.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    const handler = entry.current[type] as
      | ((action: Shortcut.Action, event: KeyboardEvent) => void | false)
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
  if (!token.startsWith('mod+')) {
    if (isHandledElsewhere(event.target, event) || event.isComposing) return
    // An open comment or reply box with unsent text keeps every plain key, wherever focus is.
    if (useShortcutStore.getState().drafting.size > 0) return
  }
  const { pending, setPending } = useShortcutStore.getState()
  const chord = pending && now - pending.at <= CHORD_MS ? `${pending.prefix} ${token}` : undefined
  setPending(undefined)
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
  if (SHORTCUTS.some((s) => s.key.startsWith(`${token} `))) setPending({ prefix: token, at: now })
}

/**
 * Binds behaviour to shortcut actions while the component is mounted. The newest binding of an
 * action wins, so a screen can take over a global key (the review screen's own `?` list).
 */
export function useShortcutHandlers(handlers: Shortcut.Handlers): void {
  const ref = useRef(handlers)
  useEffect(() => {
    ref.current = handlers
  })
  const bind = useShortcutStore((s) => s.bind)
  useEffect(() => {
    const unbind = bind(ref)
    // One `keydown` listener serves every binding, present while any is.
    window.addEventListener('keydown', handleKeydown)
    return () => {
      unbind()
      if (useShortcutStore.getState().bindings.length === 0) {
        window.removeEventListener('keydown', handleKeydown)
      }
    }
  }, [bind])
}
