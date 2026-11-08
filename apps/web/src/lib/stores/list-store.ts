import { create } from 'zustand'

/**
 * What the list screens (builds, reviews, inbox, triage) share: the row J / K stopped on, whether
 * the preview pane is open, and the rows ticked for a bulk action. Only one list is on screen at
 * a time, so a screen calls `reset` when it unmounts and the next one starts clean.
 */
export const useListStore = create<ListStore.State & ListStore.Actions>()((set, get) => ({
  ...initialListState(),
  setCursorId: (cursorId) => set({ cursorId }),
  togglePeek: () => set((s) => ({ peek: !s.peek })),
  toggleChecked: (id) => {
    const next = new Set(get().checked)
    const on = !next.has(id)
    if (on) next.add(id)
    else next.delete(id)
    set({ checked: next })
    return on
  },
  clearChecked: () => set({ checked: new Set() }),
  reset: () => set(initialListState()),
}))

function initialListState(): ListStore.State {
  return { cursorId: undefined, peek: false, checked: new Set() }
}

export namespace ListStore {
  export interface State {
    cursorId: string | undefined
    peek: boolean
    checked: ReadonlySet<string>
  }
  export interface Actions {
    setCursorId: (id: string | undefined) => void
    togglePeek: () => void
    /** Ticks or unticks a row; returns whether it is ticked now. */
    toggleChecked: (id: string) => boolean
    clearChecked: () => void
    reset: () => void
  }
}
