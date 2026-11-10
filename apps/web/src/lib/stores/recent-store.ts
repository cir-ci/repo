import { create } from 'zustand'

/** One visited thing, as the command menu's Recent lists it. */
export interface RecentEntry {
  kind: 'build' | 'team' | 'baseline' | 'triage' | 'view'
  /** Stable across visits: a visit to the same thing replaces the old one. */
  id: string
  label: string
  /** The team's name, for what belongs to one. */
  detail?: string
  path: string
  /** When it was visited (ms since the epoch). */
  at: number
}

export const RECENT_KEY = 'circi-recent'
/** How many visits are kept per workspace. */
export const RECENT_CAP = 20

type ByWorkspace = Record<string, RecentEntry[]>

const KINDS: ReadonlySet<string> = new Set(['build', 'team', 'baseline', 'triage', 'view'])

function isRecent(value: unknown): value is RecentEntry {
  return (
    typeof value === 'object' &&
    value !== null &&
    'kind' in value &&
    typeof value.kind === 'string' &&
    KINDS.has(value.kind) &&
    'id' in value &&
    typeof value.id === 'string' &&
    'label' in value &&
    typeof value.label === 'string' &&
    'path' in value &&
    typeof value.path === 'string' &&
    'at' in value &&
    typeof value.at === 'number'
  )
}

function read(): ByWorkspace {
  try {
    const raw = localStorage.getItem(RECENT_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : {}
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {}
    const kept: ByWorkspace = {}
    for (const [workspace, list] of Object.entries(parsed)) {
      if (Array.isArray(list)) kept[workspace] = list.filter(isRecent)
    }
    return kept
  } catch {
    return {}
  }
}

function write(value: ByWorkspace): void {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(value))
  } catch {
    // Storage blocked or full: Recent lasts until the page reloads.
  }
}

/**
 * The last things a person visited, per workspace (a build, team, baseline, triage item or saved
 * view), newest first. Kept in the browser only: nothing is sent to the server.
 */
export const useRecentStore = create<RecentStore.State & RecentStore.Actions>()((set, get) => ({
  byWorkspace: read(),
  record: (workspace, entry) => {
    const rest = (get().byWorkspace[workspace] ?? []).filter((e) => e.id !== entry.id)
    const byWorkspace = {
      ...get().byWorkspace,
      [workspace]: [entry, ...rest].slice(0, RECENT_CAP),
    }
    write(byWorkspace)
    set({ byWorkspace })
  },
  reset: () => set({ byWorkspace: read() }),
}))

export namespace RecentStore {
  export interface State {
    byWorkspace: ByWorkspace
  }
  export interface Actions {
    record: (workspace: string, entry: RecentEntry) => void
    /** Reads what the browser holds again (tests clear the storage first). */
    reset: () => void
  }
}
