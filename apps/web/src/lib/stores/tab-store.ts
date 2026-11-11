import { create } from 'zustand'

import {
  activate,
  activeTab,
  closeOthers,
  closeTab,
  DESKTOP_LIMITS,
  duplicateTab,
  hrefOf,
  initialTabs,
  moveTab,
  neighbour,
  NEW_TAB_HREF,
  openTab,
  type Opened,
  parseStoredTabs,
  PHONE_LIMITS,
  replaceCurrent,
  restoreClosed,
  setScroll,
  setTitle,
  stepHistory,
  tabAt,
  type Tabs,
  titleOf,
  togglePin,
  undoEviction,
  visit,
} from '#lib/tabs.ts'
import { toast } from '#lib/toast.ts'
import { isPhone } from '#lib/use-phone.ts'

export const TABS_KEY = 'circi-tabs'

const limits = (): Tabs.Limits => (isPhone() ? PHONE_LIMITS : DESKTOP_LIMITS)
const newId = () => crypto.randomUUID()

function write(owner: string, state: Tabs.State): void {
  try {
    localStorage.setItem(TABS_KEY, JSON.stringify({ owner, state }))
  } catch {
    // Storage blocked or full (a private window): the tabs last until the page reloads.
  }
}

function forget(): void {
  try {
    localStorage.removeItem(TABS_KEY)
  } catch {
    // No storage to clear.
  }
}

const EMPTY: Tabs.State = { tabs: [], activeId: '', closed: [] }

/**
 * The installed app's tabs for this device: the tab list with each tab's own history, the active
 * tab and the closed ones, kept in localStorage (guarded: it can be missing) for the signed-in
 * person and cleared on sign-out. The logic is `#lib/tabs.ts`; this applies it, saves it and
 * says what happened in toasts. `app/tab-sync.ts` keeps the router on the active tab's page.
 */
export const useTabStore = create<TabStore.State & TabStore.Actions>()((set, get) => {
  /** Applies a change and saves it (nothing is saved before `adopt` says whose tabs these are). */
  const commit = (state: Tabs.State) => {
    set({ ...state })
    const { owner } = get()
    if (owner) write(owner, state)
  }
  const snapshot = (): Tabs.State => {
    const { tabs, activeId, closed } = get()
    return { tabs, activeId, closed }
  }
  const announceEviction = (opened: Opened) => {
    const evicted = opened.evicted
    if (!evicted) return
    toast.undoable(`Closed ${titleOf(evicted.tab)} to stay within ${limits().max} tabs`, () => {
      commit(undoEviction(snapshot(), opened.id, evicted))
      return Promise.resolve()
    })
  }
  /** A toast for tabs just closed, with Undo that puts them back (`reactivate`: the one that was open is open again). */
  const announceClosed = (closedIds: readonly string[], message: string, reactivate?: string) => {
    toast.undoable(message, () => {
      for (const id of closedIds) {
        const state = snapshot()
        const found = state.closed.find((c) => c.tab.id === id)
        if (!found) continue
        commit({
          ...state,
          tabs: state.tabs.toSpliced(Math.min(found.at, state.tabs.length), 0, found.tab),
          closed: state.closed.filter((c) => c.tab.id !== id),
          ...(id === reactivate ? { activeId: id } : {}),
        })
      }
      return Promise.resolve()
    })
  }

  return {
    ...EMPTY,
    owner: null,
    adopt: (owner, href) => {
      let stored = null
      try {
        stored = parseStoredTabs(localStorage.getItem(TABS_KEY))
      } catch {
        // No storage: start with one tab.
      }
      const state = stored?.owner === owner ? stored.state : initialTabs(newId(), href, Date.now())
      set({ ...state, owner })
      write(owner, state)
      // Launched at an address the saved tab isn't on (a link, a notification): it opens there.
      if (stored?.owner === owner && href !== '/' && hrefOf(activeTab(state)) !== href) {
        commit(visit(state, href))
      }
    },
    clear: () => {
      forget()
      set({ ...EMPTY, owner: null })
    },
    open: (href, options = {}) => {
      const opened = openTab(snapshot(), {
        id: newId(),
        href,
        now: Date.now(),
        limits: limits(),
        ...(options.background ? { background: true } : {}),
      })
      commit(opened.state)
      announceEviction(opened)
      return opened.id
    },
    openNew: () => get().open(NEW_TAB_HREF),
    duplicate: (id) => {
      const opened = duplicateTab(snapshot(), id, {
        id: newId(),
        now: Date.now(),
        limits: limits(),
      })
      if (!opened) return
      commit(opened.state)
      announceEviction(opened)
    },
    close: (id) => {
      const state = snapshot()
      const tab = state.tabs.find((t) => t.id === id)
      if (!tab) return
      commit(closeTab(state, id, newId(), Date.now()))
      announceClosed([id], `Closed ${titleOf(tab)}`, id === state.activeId ? id : undefined)
    },
    closeActive: () => get().close(get().activeId),
    closeOthers: (id) => {
      const before = snapshot()
      const next = closeOthers(before, id)
      if (next === before) return
      const gone = before.tabs.filter((t) => !next.tabs.some((n) => n.id === t.id))
      commit(next)
      const [only] = gone
      announceClosed(
        gone.map((t) => t.id),
        only && gone.length === 1 ? `Closed ${titleOf(only)}` : `Closed ${gone.length} tabs`,
      )
    },
    restore: () => {
      const opened = restoreClosed(snapshot(), limits(), Date.now())
      if (!opened) return
      commit(opened.state)
      announceEviction(opened)
    },
    activate: (id) => commit(activate(snapshot(), id, Date.now())),
    step: (delta) => {
      const target = neighbour(snapshot(), delta)
      if (target) commit(activate(snapshot(), target.id, Date.now()))
    },
    goTo: (number) => {
      const target = tabAt(snapshot(), number)
      if (target) commit(activate(snapshot(), target.id, Date.now()))
    },
    togglePin: (id) => {
      const before = snapshot()
      const next = togglePin(before, id, limits())
      if (next === before) {
        toast.error(`Up to ${limits().pinned} tabs can be pinned`)
        return
      }
      commit(next)
    },
    move: (id, delta) => commit(moveTab(snapshot(), id, delta)),
    back: () => commit(stepHistory(snapshot(), -1, newId(), Date.now())),
    forward: () => commit(stepHistory(snapshot(), 1, newId(), Date.now())),
    visit: (href) => commit(visit(snapshot(), href)),
    replaceCurrent: (href) => commit(replaceCurrent(snapshot(), href)),
    setTitle: (id, title) => commit(setTitle(snapshot(), id, title)),
    setScroll: (id, scroll) => commit(setScroll(snapshot(), id, scroll)),
    reset: () => set({ ...EMPTY, owner: null }),
  }
})

export namespace TabStore {
  export interface State extends Tabs.State {
    /** Whose tabs these are; null until the signed-in frame has adopted them. */
    owner: string | null
  }
  export interface Actions {
    /** Takes this person's saved tabs (or starts with one on `href`). */
    adopt: (owner: string, href: string) => void
    /** Sign-out: forgets every tab, here and in storage. */
    clear: () => void
    /** Opens `href` in a new tab (the active one unless `background`); returns its ID. */
    open: (href: string, options?: { background?: boolean }) => string
    openNew: () => string
    duplicate: (id: string) => void
    close: (id: string) => void
    closeActive: () => void
    closeOthers: (id: string) => void
    /** Brings the newest closed tab back. */
    restore: () => void
    activate: (id: string) => void
    /** The previous (-1) or next (1) tab, wrapping. */
    step: (delta: number) => void
    /** The tab at place 1 to 8, or 9 for the last. */
    goTo: (number: number) => void
    togglePin: (id: string) => void
    move: (id: string, delta: -1 | 1) => void
    /** Back and forward inside the active tab. */
    back: () => void
    forward: () => void
    /** The active tab moves to a new page (a new history entry), or changes its current one. */
    visit: (href: string) => void
    replaceCurrent: (href: string) => void
    setTitle: (id: string, title: string) => void
    setScroll: (id: string, scroll: number) => void
    /** Empties the store without touching storage (tests clear the storage first). */
    reset: () => void
  }
}
