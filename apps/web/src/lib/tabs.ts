/**
 * The installed app's tabs, as plain data and pure functions: no router, no storage, no React.
 * `useTabStore` holds one `Tabs.State` and applies these; every function returns a new state (or
 * the same one when nothing changed), so the rules are testable without a browser.
 *
 * Each tab owns its history: a stack of addresses (`history`) and where it stands in it (`index`).
 * The window's one browser history is never used to go back; the tab's stack is.
 */

export interface Tab {
  id: string
  /** The page's title, as the strip shows it (the team tile is added from the address). */
  title: string
  pinned: boolean
  /** Every address this tab has shown, oldest first, as path + search + hash. */
  history: string[]
  /** Which of `history` is showing. */
  index: number
  /** The tab it was opened from: going back past its first page returns there. */
  opener?: string
  /** When it was last the active tab (the eviction order). */
  usedAt: number
  /** The scroll position of the page when the tab was left. */
  scroll?: number
}

export interface ClosedTab {
  tab: Tab
  /** Where it stood in the strip, so Undo puts it back there. */
  at: number
}

export interface TabsState {
  tabs: Tab[]
  activeId: string
  /** Closed tabs, newest first. */
  closed: ClosedTab[]
}

export namespace Tabs {
  export type State = TabsState
  export interface Limits {
    max: number
    pinned: number
  }
}

export const DESKTOP_LIMITS: Tabs.Limits = { max: 12, pinned: 5 }
export const PHONE_LIMITS: Tabs.Limits = { max: 8, pinned: 5 }
/** How many addresses one tab remembers. */
export const HISTORY_CAP = 50
/** How many closed tabs ⌘⇧T can bring back. */
export const CLOSED_CAP = 20
/** The page a new tab opens on (it redirects to the workspace's Inbox). */
export const NEW_TAB_HREF = '/inbox'

export const hrefOf = (tab: Tab): string => tab.history[tab.index] ?? NEW_TAB_HREF

export function createTab(id: string, href: string, now: number, opener?: string): Tab {
  return {
    id,
    title: '',
    pinned: false,
    history: [href],
    index: 0,
    usedAt: now,
    ...(opener ? { opener } : {}),
  }
}

export function initialTabs(id: string, href: string, now: number): TabsState {
  return { tabs: [createTab(id, href, now)], activeId: id, closed: [] }
}

export const activeTab = (state: TabsState): Tab =>
  state.tabs.find((t) => t.id === state.activeId) ?? state.tabs[0] ?? createTab('', NEW_TAB_HREF, 0)

const indexOf = (state: TabsState, id: string) => state.tabs.findIndex((t) => t.id === id)

const withTab = (state: TabsState, id: string, change: (tab: Tab) => Tab): TabsState => ({
  ...state,
  tabs: state.tabs.map((t) => (t.id === id ? change(t) : t)),
})

/** The tab that makes room: the least recently used unpinned tab that isn't showing. */
export function evictionCandidate(state: TabsState): Tab | undefined {
  return state.tabs
    .filter((t) => !t.pinned && t.id !== state.activeId)
    .toSorted((a, b) => a.usedAt - b.usedAt)[0]
}

function pushClosed(state: TabsState, tab: Tab, at: number): ClosedTab[] {
  return [{ tab, at }, ...state.closed].slice(0, CLOSED_CAP)
}

export interface Opened {
  state: TabsState
  id: string
  /** The tab closed to stay within the limit. */
  evicted?: ClosedTab
}

/**
 * Opens `href` in a new tab right after the active one (after the pinned ones). It becomes the
 * active tab unless `background`. At the limit the least recently used unpinned background tab is
 * closed first.
 */
export function openTab(
  state: TabsState,
  options: { id: string; href: string; now: number; background?: boolean; limits: Tabs.Limits },
): Opened {
  const { id, href, now, background = false, limits } = options
  let next = state
  let evicted: ClosedTab | undefined
  if (state.tabs.length >= limits.max) {
    const victim = evictionCandidate(state)
    if (victim) {
      evicted = { tab: victim, at: indexOf(state, victim.id) }
      next = {
        ...state,
        tabs: state.tabs.filter((t) => t.id !== victim.id),
        closed: pushClosed(state, victim, evicted.at),
      }
    }
  }
  const tab = createTab(id, href, now, state.activeId)
  const after = Math.max(indexOf(next, next.activeId), next.tabs.filter((t) => t.pinned).length - 1)
  const tabs = next.tabs.toSpliced(after + 1, 0, tab)
  return {
    state: { ...next, tabs, activeId: background ? next.activeId : id },
    id,
    ...(evicted ? { evicted } : {}),
  }
}

/** Takes an eviction back: the new tab goes, the evicted one returns to its place. */
export function undoEviction(state: TabsState, newId: string, evicted: ClosedTab): TabsState {
  const rest = state.tabs.filter((t) => t.id !== newId)
  const tabs = rest.toSpliced(Math.min(evicted.at, rest.length), 0, evicted.tab)
  const activeId =
    state.activeId === newId ? (evicted.tab.opener ?? evicted.tab.id) : state.activeId
  return {
    tabs,
    activeId: tabs.some((t) => t.id === activeId) ? activeId : (tabs[0]?.id ?? activeId),
    closed: state.closed.filter((c) => c.tab.id !== evicted.tab.id),
  }
}

/**
 * Closes a tab. The active one hands over to the tab it was opened from, else its right
 * neighbour, else its left. The last tab can't close: it becomes a new tab on `NEW_TAB_HREF`.
 */
export function closeTab(state: TabsState, id: string, replacementId: string, now: number) {
  const at = indexOf(state, id)
  const tab = state.tabs[at]
  if (!tab) return state
  if (state.tabs.length === 1) {
    return {
      tabs: [createTab(replacementId, NEW_TAB_HREF, now)],
      activeId: replacementId,
      closed: pushClosed(state, tab, 0),
    }
  }
  const tabs = state.tabs.filter((t) => t.id !== id)
  let activeId = state.activeId
  if (state.activeId === id) {
    const opener = tab.opener && tabs.some((t) => t.id === tab.opener) ? tab.opener : undefined
    activeId = opener ?? tabs[Math.min(at, tabs.length - 1)]?.id ?? state.activeId
  }
  return { tabs, activeId, closed: pushClosed(state, tab, at) }
}

/** Closes every tab but `id` and the pinned ones. */
export function closeOthers(state: TabsState, id: string): TabsState {
  const keep = (t: Tab) => t.id === id || t.pinned
  const gone = state.tabs.flatMap((t, at) => (keep(t) ? [] : [{ tab: t, at }]))
  if (gone.length === 0) return state
  return {
    tabs: state.tabs.filter(keep),
    activeId: id,
    closed: [...gone.toReversed(), ...state.closed].slice(0, CLOSED_CAP),
  }
}

/** Puts the newest closed tab back where it was; it becomes the active tab. */
export function restoreClosed(state: TabsState, limits: Tabs.Limits, now: number): Opened | null {
  const [last, ...closed] = state.closed
  if (!last) return null
  let tabs = state.tabs
  let evicted: ClosedTab | undefined
  if (tabs.length >= limits.max) {
    const victim = evictionCandidate(state)
    if (victim) {
      evicted = { tab: victim, at: indexOf(state, victim.id) }
      tabs = tabs.filter((t) => t.id !== victim.id)
    }
  }
  const tab: Tab = { ...last.tab, usedAt: now }
  const restored = tabs.toSpliced(Math.min(last.at, tabs.length), 0, tab)
  const closedAfter = evicted ? [evicted, ...closed].slice(0, CLOSED_CAP) : closed
  return {
    state: { tabs: restored, activeId: tab.id, closed: closedAfter },
    id: tab.id,
    ...(evicted ? { evicted } : {}),
  }
}

/** Makes `id` the active tab. */
export function activate(state: TabsState, id: string, now: number): TabsState {
  if (state.activeId === id || indexOf(state, id) < 0) return state
  return { ...withTab(state, id, (t) => ({ ...t, usedAt: now })), activeId: id }
}

/** The tab `delta` places from the active one, wrapping round the ends. */
export function neighbour(state: TabsState, delta: number): Tab | undefined {
  const count = state.tabs.length
  const at = indexOf(state, state.activeId)
  return state.tabs[(((at + delta) % count) + count) % count]
}

/** ⌥1 to ⌥8 are the first eight tabs, ⌥9 the last one, as in browsers. */
export function tabAt(state: TabsState, number: number): Tab | undefined {
  return number === 9 ? state.tabs.at(-1) : state.tabs[number - 1]
}

/** Pins or unpins; pinned tabs gather at the start. Refused (unchanged) beyond the pin limit. */
export function togglePin(state: TabsState, id: string, limits: Tabs.Limits): TabsState {
  const tab = state.tabs.find((t) => t.id === id)
  if (!tab) return state
  if (!tab.pinned && state.tabs.filter((t) => t.pinned).length >= limits.pinned) return state
  const flipped = { ...tab, pinned: !tab.pinned }
  const rest = state.tabs.filter((t) => t.id !== id)
  // Pinned tabs first; the one just pinned ends the pinned group, the one just unpinned starts the rest.
  const tabs = [...rest.filter((t) => t.pinned), flipped, ...rest.filter((t) => !t.pinned)]
  return { ...state, tabs }
}

/** Moves a tab one place; it never crosses between the pinned and the other tabs. */
export function moveTab(state: TabsState, id: string, delta: -1 | 1): TabsState {
  const at = indexOf(state, id)
  const to = at + delta
  const tab = state.tabs[at]
  const other = state.tabs[to]
  if (!tab || !other || tab.pinned !== other.pinned) return state
  const tabs = state.tabs.slice()
  tabs[at] = other
  tabs[to] = tab
  return { ...state, tabs }
}

/** Opens a copy of a tab beside it, with the same page and no history. */
export function duplicateTab(
  state: TabsState,
  id: string,
  options: { id: string; now: number; limits: Tabs.Limits },
): Opened | null {
  const tab = state.tabs.find((t) => t.id === id)
  if (!tab) return null
  const opened = openTab(state, { ...options, href: hrefOf(tab) })
  return { ...opened, state: setTitle(opened.state, options.id, tab.title) }
}

/** A page the tab is leaving no longer has the position that was saved for the old one. */
function withoutScroll(tab: Tab): Tab {
  const copy = { ...tab }
  delete copy.scroll
  return copy
}

/** The active tab goes to `href`: a new entry in its history, forward entries dropped. */
export function visit(state: TabsState, href: string): TabsState {
  const tab = activeTab(state)
  if (hrefOf(tab) === href) return state
  const kept = tab.history.slice(0, tab.index + 1)
  const history = [...kept, href].slice(-HISTORY_CAP)
  return withTab(state, tab.id, (t) => ({
    ...withoutScroll(t),
    history,
    index: history.length - 1,
  }))
}

/** The active tab's current page changes without a new history entry (a redirect, a filter). */
export function replaceCurrent(state: TabsState, href: string): TabsState {
  const tab = activeTab(state)
  if (hrefOf(tab) === href) return state
  return withTab(state, tab.id, (t) => ({
    ...t,
    history: t.history.map((h, i) => (i === t.index ? href : h)),
  }))
}

/**
 * Back (`-1`) or forward (`1`) inside the active tab. At the first page of a tab that was opened
 * from another, back closes it and returns there. Nothing else happens past the ends.
 */
export function stepHistory(
  state: TabsState,
  delta: number,
  replacementId: string,
  now: number,
): TabsState {
  const tab = activeTab(state)
  const index = tab.index + delta
  if (index >= 0 && index < tab.history.length) {
    return withTab(state, tab.id, (t) => ({ ...withoutScroll(t), index }))
  }
  if (index < 0 && tab.opener && indexOf(state, tab.opener) >= 0) {
    return closeTab(state, tab.id, replacementId, now)
  }
  return state
}

export const setTitle = (state: TabsState, id: string, title: string): TabsState => {
  const tab = state.tabs.find((t) => t.id === id)
  return !tab || tab.title === title ? state : withTab(state, id, (t) => ({ ...t, title }))
}

export const setScroll = (state: TabsState, id: string, scroll: number): TabsState =>
  withTab(state, id, (t) => ({ ...t, scroll }))

/** Labels for the strip: a title shared by several tabs gets the tab's position to tell them apart. */
export const titleOf = (tab: Tab): string => tab.title || 'New tab'

// Persistence ------------------------------------------------------------------------------

export interface StoredTabs {
  /** Who the tabs belong to (a different person signing in starts with none). */
  owner: string
  state: TabsState
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

/** A stored tab with its fields checked, or undefined. */
function readTab(value: unknown): Tab | undefined {
  if (!isRecord(value)) return undefined
  const { id, title, pinned, history, index, usedAt, opener, scroll } = value
  if (
    typeof id !== 'string' ||
    typeof title !== 'string' ||
    typeof pinned !== 'boolean' ||
    !Array.isArray(history) ||
    typeof index !== 'number' ||
    typeof usedAt !== 'number'
  )
    return undefined
  const pages = history.filter((h): h is string => typeof h === 'string' && h.startsWith('/'))
  if (pages.length === 0 || pages.length !== history.length) return undefined
  if (!Number.isInteger(index) || index < 0 || index >= pages.length) return undefined
  return {
    id,
    title,
    pinned,
    history: pages,
    index,
    usedAt,
    ...(typeof opener === 'string' ? { opener } : {}),
    ...(typeof scroll === 'number' ? { scroll } : {}),
  }
}

/** The tabs from what was stored, or null for anything that isn't a valid set. */
export function parseStoredTabs(raw: string | null): StoredTabs | null {
  if (!raw) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!isRecord(parsed) || typeof parsed['owner'] !== 'string') return null
    const state = parsed['state']
    if (!isRecord(state) || !Array.isArray(state['tabs'])) return null
    const tabs = state['tabs'].flatMap((t: unknown) => readTab(t) ?? [])
    const first = tabs[0]
    if (!first) return null
    const stored = state['activeId']
    const activeId = tabs.find((t) => t.id === stored)?.id ?? first.id
    const closed = (Array.isArray(state['closed']) ? state['closed'] : []).flatMap((c: unknown) => {
      const tab = isRecord(c) ? readTab(c['tab']) : undefined
      return isRecord(c) && tab && typeof c['at'] === 'number' ? [{ tab, at: c['at'] }] : []
    })
    return {
      owner: parsed['owner'],
      state: { tabs, activeId, closed: closed.slice(0, CLOSED_CAP) },
    }
  } catch {
    return null
  }
}
