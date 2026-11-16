import { useEffect, useRef } from 'react'

import { DESIGN_MODE, VIEW_MODES, type ViewMode } from '#features/builds/search.ts'
import { isInstalled } from '#lib/document-title.ts'
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
  /** Only in the installed app (tabs): never matched or listed in a browser tab. */
  installed?: true
  /** Left out of the help (a key of a run of them that one row already stands for). */
  listed?: false
}

export namespace Shortcut {
  /** Where a shortcut applies: everywhere, in a list of rows, or on the build review screen. */
  export type Scope = 'global' | 'list' | 'inbox' | 'triage' | 'build-review'

  export type Group =
    | 'General'
    | 'Navigation'
    | 'Tabs'
    | 'Lists'
    | 'Inbox'
    | 'Build review'
    | 'Triage'

  export type GoTarget = 'inbox' | 'reviews' | 'projects' | 'triage' | 'settings'

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
    | { type: 'assignMe' }
    | { type: 'dismiss' }
    | { type: 'approve' }
    | { type: 'approveAll' }
    | { type: 'reject' }
    | { type: 'comment' }
    | { type: 'submit' }
    | { type: 'help' }
    | { type: 'toggleSidebar' }
    | { type: 'command' }
    | { type: 'copyLink' }
    | { type: 'openInTab' }
    | { type: 'newTab' }
    | { type: 'closeTab' }
    | { type: 'restoreTab' }
    | { type: 'goToTab'; number: number }
    | { type: 'stepTab'; delta: -1 | 1 }
    | { type: 'pinTab' }
    | { type: 'moveTab'; delta: -1 | 1 }
    | { type: 'go'; to: GoTarget }
    | { type: 'mode'; mode: ViewMode }
    | { type: 'diffLayer'; delta: -10 | 10 }
    | { type: 'peekBaseline' }

  /** The handler for each action type; `useShortcutHandlers` binds them. */
  export type Handlers = {
    [A in Action as A['type']]?: (action: A, event: KeyboardEvent) => void | false
  }
}

const MODE_NAME: Record<ViewMode, string> = {
  side: 'Side by side',
  diff: 'Diff',
  slider: 'Slider',
  design: 'Design',
}

export const MODE_OPTIONS = VIEW_MODES.map((value) => ({ value, label: MODE_NAME[value] }))

/** ⌥1 to ⌥9: one entry each so the keys match, but the help lists the first for all of them. */
function tabNumberShortcut(n: number): Shortcut {
  const shortcut: Shortcut = {
    key: `alt+${n}`,
    scope: 'global',
    group: 'Tabs',
    description:
      n === 1 ? 'Go to a tab: ⌥1 to ⌥8 are the first eight, ⌥9 the last' : `Go to tab ${n}`,
    action: { type: 'goToTab', number: n },
    installed: true,
  }
  if (n !== 1) shortcut.listed = false
  return shortcut
}

/** ⌥1 to ⌥9. */
const TAB_NUMBERS = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const

const GO: readonly [string, Shortcut.GoTarget, string][] = [
  ['g i', 'inbox', 'Open Inbox'],
  ['g r', 'reviews', 'Open Reviews'],
  ['g p', 'projects', 'Open Projects'],
  ['g t', 'triage', 'Open Triage'],
  ['g s', 'settings', 'Open Settings'],
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
    key: 'mod+\\',
    scope: 'global',
    group: 'General',
    description: 'Hide or show the sidebar',
    action: { type: 'toggleSidebar' },
  },
  {
    key: '?',
    scope: 'global',
    group: 'General',
    description: 'Show this list',
    action: { type: 'help' },
  },
  {
    key: 'alt+t',
    scope: 'global',
    group: 'Tabs',
    description: 'New tab',
    action: { type: 'newTab' },
    installed: true,
  },
  {
    key: 'alt+w',
    scope: 'global',
    group: 'Tabs',
    description: 'Close tab',
    action: { type: 'closeTab' },
    installed: true,
  },
  {
    key: 'mod+shift+t',
    scope: 'global',
    group: 'Tabs',
    description: 'Reopen closed tab',
    action: { type: 'restoreTab' },
    installed: true,
  },
  ...TAB_NUMBERS.map(tabNumberShortcut),
  {
    key: 'alt+ArrowLeft',
    scope: 'global',
    group: 'Tabs',
    description: 'Previous tab',
    action: { type: 'stepTab', delta: -1 },
    installed: true,
  },
  {
    key: 'alt+ArrowRight',
    scope: 'global',
    group: 'Tabs',
    description: 'Next tab',
    action: { type: 'stepTab', delta: 1 },
    installed: true,
  },
  {
    key: 'alt+p',
    scope: 'global',
    group: 'Tabs',
    description: 'Pin or unpin the tab',
    action: { type: 'pinTab' },
    installed: true,
  },
  {
    key: 'alt+shift+ArrowLeft',
    scope: 'global',
    group: 'Tabs',
    description: 'Move the tab left',
    action: { type: 'moveTab', delta: -1 },
    installed: true,
  },
  {
    key: 'alt+shift+ArrowRight',
    scope: 'global',
    group: 'Tabs',
    description: 'Move the tab right',
    action: { type: 'moveTab', delta: 1 },
    installed: true,
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
    key: 'mod+Enter',
    scope: 'list',
    group: 'Lists',
    description: 'Open in a new tab',
    action: { type: 'openInTab' },
    installed: true,
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
    description: 'Approve screenshot',
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
    description: 'Reject screenshot, with a reason',
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
  {
    key: '[',
    scope: 'build-review',
    group: 'Build review',
    description:
      'Diff: show less or more of this build under the changed pixels, by 10% (with [ and ])',
    action: { type: 'diffLayer', delta: -10 },
  },
  {
    key: ']',
    scope: 'build-review',
    group: 'Build review',
    description: 'Diff: show more of this build',
    action: { type: 'diffLayer', delta: 10 },
    listed: false,
  },
  {
    // Never matched by `handleKeydown` (a bare Alt has no token): the viewer listens for it, hold it.
    key: 'alt',
    scope: 'build-review',
    group: 'Build review',
    description: 'Diff: hold to peek at this build',
    action: { type: 'peekBaseline' },
  },
]

/** Whether the help lists and the screen honours a shortcut: the Design mode needs the integration. */
export const isAvailable = (s: Shortcut, designEnabled: boolean, installed = isInstalled()) =>
  (designEnabled || s.action.type !== 'mode' || s.action.mode !== DESIGN_MODE) &&
  (installed || !s.installed)

/** Whether a key press is ⌘↵ / Ctrl+↵, which sends a comment or confirms a dialog from its text field. */
export const isSubmitKey = (
  e: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>,
) => keyToken(e) === 'mod+Enter'

export const shortcutFor = (key: string): Shortcut | undefined =>
  SHORTCUTS.find((s) => s.key === key)

/** Every shortcut a key is declared for (⌘↵ is both "open in a new tab" and, on the build page, "send"). */
const shortcutsFor = (key: string): Shortcut[] => SHORTCUTS.filter((s) => s.key === key)

/** The groups in the order the help and the shortcuts page show them: every `Shortcut.Group`, once. */
export const GROUP_ORDER: readonly Shortcut.Group[] = [
  'General',
  'Navigation',
  'Tabs',
  'Lists',
  'Inbox',
  'Build review',
  'Triage',
]

/** The shortcuts under their group headings in `GROUP_ORDER`, for the help dialog and the page. */
export function shortcutGroups(
  designEnabled = false,
  installed = isInstalled(),
): { group: Shortcut.Group; shortcuts: Shortcut[] }[] {
  const groups: { group: Shortcut.Group; shortcuts: Shortcut[] }[] = []
  for (const shortcut of SHORTCUTS) {
    if (!isAvailable(shortcut, designEnabled, installed) || shortcut.listed === false) continue
    const found = groups.find((g) => g.group === shortcut.group)
    if (found) found.shortcuts.push(shortcut)
    else groups.push({ group: shortcut.group, shortcuts: [shortcut] })
  }
  return groups.toSorted((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group))
}

const KEY_LABEL: Record<string, string> = {
  mod: '⌘',
  alt: '⌥',
  shift: '⇧',
  ArrowLeft: '←',
  ArrowRight: '→',
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

/**
 * An Alt (Option) press, named by the physical key: ⌥T types "†" on a Mac, so the character says
 * nothing. Only letters, digits and the arrows are shortcuts; Alt with ⌘ or Ctrl never is.
 */
function altToken(
  event: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'shiftKey'> &
    Partial<Pick<KeyboardEvent, 'code'>>,
): string | undefined {
  if (event.metaKey || event.ctrlKey) return undefined
  const code = event.code ?? ''
  // `[` and `]` are the keys that type them, with or without Option (some layouts need it), or the
  // physical bracket keys (Option changes the character they type).
  if (event.key === '[' || code === 'BracketLeft') return '['
  if (event.key === ']' || code === 'BracketRight') return ']'
  const key = /^Key[A-Z]$/.test(code)
    ? code.slice(3).toLowerCase()
    : /^Digit[0-9]$/.test(code)
      ? code.slice(5)
      : code === 'ArrowLeft' || code === 'ArrowRight'
        ? code
        : undefined
  return key ? ['alt', event.shiftKey ? 'shift' : '', key].filter(Boolean).join('+') : undefined
}

/** What a key press is called in `SHORTCUTS`, or undefined for a press that is never a shortcut (Alt). */
export function keyToken(
  event: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'> &
    Partial<Pick<KeyboardEvent, 'code'>>,
): string | undefined {
  if (event.altKey) return altToken(event)
  const key =
    event.key === ' ' ? 'space' : event.key.length === 1 ? event.key.toLowerCase() : event.key
  const mod = event.metaKey || event.ctrlKey
  // Shift only tells keys apart when it is not what makes the character (`?`, `A`).
  const shift = event.shiftKey && (mod || /^[a-z]$/.test(key))
  return [mod ? 'mod' : '', shift ? 'shift' : '', key].filter(Boolean).join('+')
}

/**
 * Anything a person types into: fields, selects, any contenteditable and the text-entry roles. A
 * range input (a slider's thumb) takes arrow keys only, so the shortcuts stay live while it has focus.
 */
const EDITABLE =
  'input:not([type="range"]), textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="combobox"], [role="searchbox"]'

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
  isBracket = false,
): boolean {
  if (event.metaKey || event.ctrlKey || (event.altKey && !isBracket)) return true
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
    // A handler that returns `false` leaves the key to the browser (Enter on a focused link), or
    // to another shortcut of the same key (⌘↵ on the build page sends the comment).
    if (handler(shortcut.action, event) === false) return false
    event.preventDefault()
    return true
  }
  return false
}

/** Matches a key press against `SHORTCUTS` (with chord state) and runs the newest handler for it. */
export function handleKeydown(event: KeyboardEvent, now = Date.now()): void {
  const token = keyToken(event)
  if (token === undefined) return
  const installed = isInstalled()
  if (token.startsWith('alt+')) {
    // Option keys type characters (and word-jump) in a field: they are the tabs' only elsewhere.
    const where = event.target instanceof Element ? event.target : document.activeElement
    if (!installed || event.isComposing || (where && isEditable(where))) return
  } else if (!token.startsWith('mod+')) {
    // A shortcut with ⌘/Ctrl is meant to work anywhere; the rest leave typing and dialogs alone.
    if (
      isHandledElsewhere(event.target, event, token === '[' || token === ']') ||
      event.isComposing
    )
      return
    // An open comment or reply box with unsent text keeps every plain key, wherever focus is.
    if (useShortcutStore.getState().drafting.size > 0) return
  }
  const { pending, setPending } = useShortcutStore.getState()
  const chord = pending && now - pending.at <= CHORD_MS ? `${pending.prefix} ${token}` : undefined
  setPending(undefined)
  const bound = (key: string) => shortcutsFor(key).filter((s) => installed || !s.installed)
  // The first shortcut of a key that a screen has a handler for takes it.
  for (const shortcuts of [chord ? bound(chord) : [], bound(token)]) {
    if (shortcuts.length === 0) continue
    shortcuts.some((s) => run(s, event))
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
