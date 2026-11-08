import { create } from 'zustand'

import type { Shortcut } from '#lib/shortcuts.ts'

/** A screen's handlers, in a ref so they stay current without rebinding. */
export type ShortcutBinding = { current: Shortcut.Handlers }

/**
 * The keyboard layer's state: the stack of bindings (the newest binding of an action wins) and
 * the first key of a half-typed chord (`g` of `g i`).
 */
export const useShortcutStore = create<ShortcutStore.State & ShortcutStore.Actions>()((set) => ({
  ...initialShortcutState(),
  bind: (binding) => {
    set((s) => ({ bindings: [...s.bindings, binding] }))
    return () => set((s) => ({ bindings: s.bindings.filter((b) => b !== binding) }))
  },
  setPending: (pending) => set({ pending }),
  reset: () => set(initialShortcutState()),
}))

function initialShortcutState(): ShortcutStore.State {
  return { bindings: [], pending: undefined }
}

export namespace ShortcutStore {
  export interface State {
    bindings: readonly ShortcutBinding[]
    pending: { prefix: string; at: number } | undefined
  }
  export interface Actions {
    /** Pushes a binding on top of the stack; returns the function that removes it. */
    bind: (binding: ShortcutBinding) => () => void
    setPending: (pending: State['pending']) => void
    reset: () => void
  }
}
