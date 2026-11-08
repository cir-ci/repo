import { create } from 'zustand'
import { persist, type PersistStorage } from 'zustand/middleware'

import {
  DEFAULT_DISPLAY,
  DISPLAY_KEY,
  type DisplayOptions,
  parseDisplay,
} from '#features/teams/display-options.ts'

/**
 * The builds list's display options (grouping, order, shown properties), kept in localStorage.
 * Storage may be missing or blocked: reads then give the defaults and writes are dropped, so the
 * options still apply for this visit.
 */
const storage: PersistStorage<DisplayStore.State> = {
  getItem: (name) => {
    try {
      return { state: { display: parseDisplay(localStorage.getItem(name)) } }
    } catch {
      return null
    }
  },
  setItem: (name, value) => {
    try {
      localStorage.setItem(name, JSON.stringify(value.state.display))
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

export const useDisplayStore = create<DisplayStore.State & DisplayStore.Actions>()(
  persist(
    (set) => ({
      display: DEFAULT_DISPLAY,
      setDisplay: (display) => set({ display }),
      reset: () => set({ display: DEFAULT_DISPLAY }),
    }),
    {
      name: DISPLAY_KEY,
      storage,
      partialize: (s) => ({ display: s.display }),
    },
  ),
)

export namespace DisplayStore {
  export interface State {
    display: DisplayOptions
  }
  export interface Actions {
    setDisplay: (display: DisplayOptions) => void
    reset: () => void
  }
}
