import { create } from 'zustand'

import { HttpError } from '#lib/http.ts'

/** How long a toast with Undo stays. The server keeps the undo for longer (30 seconds). */
export const UNDO_MS = 6000
/** How long a confirmation without Undo stays. */
const CONFIRM_MS = 4000

/** What a toast says, and how to take back the change it confirms. */
export interface ToastInput {
  message: string
  /**
   * Takes the change back on the server (`POST …/undo/:id` with the token the action returned).
   * Left out: the change is not undoable and the toast only confirms it.
   */
  undo?: () => Promise<unknown>
  /** What to say when the undo fails for no reason the server gave. */
  undoFailed?: string
}

let timer: ReturnType<typeof setTimeout> | undefined
let current: ToastInput | undefined

/**
 * The toast at the foot of the page: a confirmation (`Approved build #148`), with Undo when the
 * change can still be taken back. The change has already happened; Undo asks the server to revert
 * it, and says why when it can't (somebody changed the same thing since, or it took too long).
 */
export const useUndoStore = create<UndoStore.State & UndoStore.Actions>()((set, get) => ({
  toast: undefined,
  show: (input) => {
    clearTimeout(timer)
    current = input
    set({
      toast: {
        id: Date.now() + Math.random(),
        message: input.message,
        undoable: input.undo !== undefined,
      },
    })
    timer = setTimeout(
      () => {
        current = undefined
        set({ toast: undefined })
      },
      input.undo ? UNDO_MS : CONFIRM_MS,
    )
  },
  undo: async () => {
    const input = current
    clearTimeout(timer)
    current = undefined
    set({ toast: undefined })
    if (!input?.undo) return
    try {
      await input.undo()
      get().show({ message: 'Undone' })
    } catch (error) {
      // A refusal carries its reason (409: "Someone changed this review since…").
      const reason = error instanceof HttpError && error.status < 500 ? error.message : undefined
      get().show({ message: reason ?? input.undoFailed ?? "Couldn't undo that" })
    }
  },
  dismiss: () => {
    clearTimeout(timer)
    current = undefined
    set({ toast: undefined })
  },
  reset: () => {
    clearTimeout(timer)
    current = undefined
    set({ toast: undefined })
  },
}))

export namespace UndoStore {
  export interface State {
    toast: { id: number; message: string; undoable: boolean } | undefined
  }
  export interface Actions {
    show: (input: ToastInput) => void
    undo: () => Promise<void>
    dismiss: () => void
    reset: () => void
  }
}
