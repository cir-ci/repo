import { create } from 'zustand'
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware'

import { type NavPaneId, type PaneId, PANE_IDS, PANES, paneWidth } from '#lib/panes.ts'

export const PANES_KEY = 'circi.panes'

/** localStorage that never throws: missing or blocked storage reads as empty and drops writes. */
const safeStorage: StateStorage = {
  getItem: (name) => {
    try {
      return localStorage.getItem(name)
    } catch {
      return null
    }
  },
  setItem: (name, value) => {
    try {
      localStorage.setItem(name, value)
    } catch {
      // Not persisted (private window, blocked storage).
    }
  },
  removeItem: (name) => {
    try {
      localStorage.removeItem(name)
    } catch {
      // Nothing to remove.
    }
  },
}

/**
 * The widths of the resizable panes and whether the two navigation panes are collapsed, kept in
 * localStorage (one entry). A missing id means the default; a stored width outside today's range
 * is held to it when it is loaded.
 */
export const usePaneStore = create<PaneStore.State & PaneStore.Actions>()(
  persist(
    (set) => ({
      ...initialPaneState(),
      setWidth: (id, width) =>
        set((s) => ({ widths: { ...s.widths, [id]: paneWidth(id, width) } })),
      resetWidth: (id) =>
        set((s) => {
          const widths = { ...s.widths }
          delete widths[id]
          return { widths }
        }),
      setCollapsed: (id, collapsed) =>
        set((s) => ({ collapsed: { ...s.collapsed, [id]: collapsed } })),
      reset: () => set(initialPaneState()),
    }),
    {
      name: PANES_KEY,
      storage: createJSONStorage(() => safeStorage),
      partialize: (s) => ({ widths: s.widths, collapsed: s.collapsed }),
      merge: (persisted, current) => {
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- parsed from storage, checked field by field below
        const saved = persisted as Partial<PaneStore.State> | null | undefined
        const widths: PaneStore.State['widths'] = {}
        for (const id of PANE_IDS) {
          const stored = saved?.widths?.[id]
          if (typeof stored === 'number') widths[id] = paneWidth(id, stored)
        }
        return {
          ...current,
          widths,
          collapsed: {
            sidebar: saved?.collapsed?.sidebar === true,
            'settings-nav': saved?.collapsed?.['settings-nav'] === true,
          },
        }
      },
    },
  ),
)

function initialPaneState(): PaneStore.State {
  return { widths: {}, collapsed: { sidebar: false, 'settings-nav': false } }
}

/** A pane's current width (its default until it has been dragged). */
export function usePaneWidth(id: PaneId): number {
  return usePaneStore((s) => s.widths[id] ?? PANES[id].default)
}

export namespace PaneStore {
  export interface State {
    widths: Partial<Record<PaneId, number>>
    collapsed: Record<NavPaneId, boolean>
  }
  export interface Actions {
    /** Sets the width, held to the pane's range. */
    setWidth: (id: PaneId, width: number) => void
    /** Back to the default. */
    resetWidth: (id: PaneId) => void
    setCollapsed: (id: NavPaneId, collapsed: boolean) => void
    reset: () => void
  }
}
