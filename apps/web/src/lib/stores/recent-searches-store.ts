import { create } from 'zustand'

export const RECENT_SEARCHES_KEY = 'circi-recent-searches'
/** How many searches are kept per workspace. */
export const RECENT_SEARCHES_CAP = 8

type ByWorkspace = Record<string, string[]>

function read(): ByWorkspace {
  try {
    const raw = localStorage.getItem(RECENT_SEARCHES_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : {}
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {}
    const kept: ByWorkspace = {}
    for (const [workspace, list] of Object.entries(parsed)) {
      if (Array.isArray(list)) {
        kept[workspace] = list.filter((t): t is string => typeof t === 'string' && t !== '')
      }
    }
    return kept
  } catch {
    return {}
  }
}

function write(value: ByWorkspace): void {
  try {
    localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(value))
  } catch {
    // Storage blocked or full: the searches last until the page reloads.
  }
}

/**
 * What the person typed into the command menu before choosing a result, per workspace, newest
 * first, as the text to type again (a prefix like `#` included). Kept in this browser only.
 */
export const useRecentSearchesStore = create<
  RecentSearchesStore.State & RecentSearchesStore.Actions
>()((set, get) => ({
  byWorkspace: read(),
  record: (workspace, text) => {
    const trimmed = text.trim()
    if (trimmed === '') return
    const rest = (get().byWorkspace[workspace] ?? []).filter(
      (t) => t.toLowerCase() !== trimmed.toLowerCase(),
    )
    const byWorkspace = {
      ...get().byWorkspace,
      [workspace]: [trimmed, ...rest].slice(0, RECENT_SEARCHES_CAP),
    }
    write(byWorkspace)
    set({ byWorkspace })
  },
  clear: (workspace) => {
    const { [workspace]: _gone, ...byWorkspace } = get().byWorkspace
    write(byWorkspace)
    set({ byWorkspace })
  },
  reset: () => set({ byWorkspace: read() }),
}))

export namespace RecentSearchesStore {
  export interface State {
    byWorkspace: ByWorkspace
  }
  export interface Actions {
    record: (workspace: string, text: string) => void
    /** Forgets the workspace's searches. */
    clear: (workspace: string) => void
    /** Reads what the browser holds again (tests clear the storage first). */
    reset: () => void
  }
}
