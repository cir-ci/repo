import { create } from 'zustand'

import type { Shortcut } from '#lib/shortcuts.ts'

/** A screen's handlers, in a ref so they stay current without rebinding. */
export type ShortcutBinding = { current: Shortcut.Handlers }

/**
 * The keyboard layer's state: the stack of bindings (the newest binding of an action wins), the
 * first key of a half-typed chord (`g` of `g i`), and the comment boxes that hold unsent text
 * (while any does, plain keys are the writer's, wherever focus happens to be).
 */
export const useShortcutStore = create<ShortcutStore.State & ShortcutStore.Actions>()((set) => ({
  ...initialShortcutState(),
  bind: (binding) => {
    set((s) => ({ bindings: [...s.bindings, binding] }))
    return () => set((s) => ({ bindings: s.bindings.filter((b) => b !== binding) }))
  },
  setPending: (pending) => set({ pending }),
  setDrafting: (id, drafting) =>
    set((s) => {
      if (s.drafting.has(id) === drafting) return s
      const next = new Set(s.drafting)
      if (drafting) next.add(id)
      else next.delete(id)
      return { drafting: next }
    }),
  reset: () => set(initialShortcutState()),
}))

function initialShortcutState(): ShortcutStore.State {
  return { bindings: [], pending: undefined, drafting: new Set() }
}

export namespace ShortcutStore {
  export interface State {
    bindings: readonly ShortcutBinding[]
    pending: { prefix: string; at: number } | undefined
    /** Ids of the comment or reply boxes that are open and have text. */
    drafting: ReadonlySet<string>
  }
  export interface Actions {
    /** Pushes a binding on top of the stack; returns the function that removes it. */
    bind: (binding: ShortcutBinding) => () => void
    setPending: (pending: State['pending']) => void
    /** A comment box (by its own id) now holds, or no longer holds, unsent text. */
    setDrafting: (id: string, drafting: boolean) => void
    reset: () => void
  }
}
