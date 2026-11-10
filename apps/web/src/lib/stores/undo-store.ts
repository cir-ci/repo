import { create } from 'zustand'

/** How long a change waits for Undo before it is sent. */
export const UNDO_MS = 6000
/** How long a confirmation without Undo stays. */
const CONFIRM_MS = 4000

/** What a toast was shown for. `commit` is what the change really does; it is sent unless Undo comes first. */
export interface ToastInput {
  message: string
  /** The change that Undo cancels. Left out: the toast is only a confirmation. */
  commit?: () => Promise<unknown>
  /** What to say when `commit` fails. */
  failed?: string
}

let timer: ReturnType<typeof setTimeout> | undefined
let pending: ToastInput | undefined

/** Sends the waiting change now (the next toast, leaving the page and closing the tab all do). */
function settle(): Promise<void> {
  clearTimeout(timer)
  const change = pending
  pending = undefined
  if (!change?.commit) return Promise.resolve()
  return change.commit().then(
    () => undefined,
    () => {
      useUndoStore.getState().show({ message: change.failed ?? "Couldn't save that change" })
    },
  )
}

/**
 * The toast at the foot of the page: a confirmation (`Approved build #148`), with Undo when the
 * change can still be taken back. The server has no way to revoke a decision, so an undoable change
 * is held back for `UNDO_MS` and sent when that passes, when another one comes, or when the page is
 * left; Undo drops it unsent.
 */
export const useUndoStore = create<UndoStore.State & UndoStore.Actions>()((set) => ({
  toast: undefined,
  show: (input) => {
    void settle()
    pending = input
    set({
      toast: {
        id: Date.now() + Math.random(),
        message: input.message,
        undoable: input.commit !== undefined,
      },
    })
    timer = setTimeout(
      () => {
        void settle()
        set({ toast: undefined })
      },
      input.commit ? UNDO_MS : CONFIRM_MS,
    )
  },
  undo: () => {
    clearTimeout(timer)
    pending = undefined
    set({ toast: undefined })
  },
  dismiss: () => {
    void settle()
    set({ toast: undefined })
  },
  flush: () => settle(),
  reset: () => {
    clearTimeout(timer)
    pending = undefined
    set({ toast: undefined })
  },
}))

if (typeof window !== 'undefined') {
  // A change still waiting for Undo is sent when the tab is hidden or closed.
  window.addEventListener('pagehide', () => void settle())
}

export namespace UndoStore {
  export interface State {
    toast: { id: number; message: string; undoable: boolean } | undefined
  }
  export interface Actions {
    show: (input: ToastInput) => void
    undo: () => void
    dismiss: () => void
    flush: () => Promise<void>
    reset: () => void
  }
}
