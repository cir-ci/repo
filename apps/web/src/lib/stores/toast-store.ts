import { createToastManager, TOAST_ERROR_MS, type ToastTone } from '@circi/ui'
import { create } from 'zustand'

import { HttpError } from '#lib/http.ts'

/** How long a toast with Undo stays. The server keeps the undo for longer (30 seconds). */
export const UNDO_MS = 6000

/** What a toast says, and how to take back the change it confirms. */
export interface ToastInput {
  message: string
  /** `success` (the default) or `error`; an error stays longer. */
  tone?: ToastTone
  /**
   * Takes the change back (the server's `POST …/undo/:id` with the token the action returned, or
   * the exact inverse call). Left out: the change is not undoable and the toast only confirms it.
   */
  undo?: () => Promise<unknown>
  /** What to say when the undo fails for no reason the server gave. */
  undoFailed?: string
}

/** The renderer's manager: the `ToastProvider` in the app (and in test renders) takes this one. */
export const toastManager = createToastManager()

/** The undo of each toast still open, by toast ID. */
const undos = new Map<string, () => Promise<unknown>>()
const undoFailures = new Map<string, string | undefined>()

/**
 * The toasts at the foot of the page, one entry for each that is open: a confirmation (`Approved
 * build #148`) or a failure (`Couldn't save: …`), with Undo while a change can still be taken
 * back. The change has already happened; Undo reverts it, and says why when it can't (somebody
 * changed the same thing since, or it took too long). The component that draws them is
 * `ToastViewport` in `@circi/ui`; screen readers hear each one through its live region, so a
 * message is never also announced.
 */
export const useToastStore = create<ToastStore.State & ToastStore.Actions>()((set, get) => ({
  toasts: [],
  show: (input) => {
    const tone = input.tone ?? 'success'
    const ref = { id: '' }
    const id: string = toastManager.add({
      title: input.message,
      timeout: tone === 'error' ? TOAST_ERROR_MS : input.undo ? UNDO_MS : undefined,
      data: { tone },
      onClose: () => forget(ref.id),
      ...(input.undo
        ? {
            actionProps: {
              children: 'Undo',
              onClick: () => void get().undo(ref.id),
            },
          }
        : {}),
    })
    ref.id = id
    if (input.undo) {
      undos.set(id, input.undo)
      undoFailures.set(id, input.undoFailed)
    }
    set((s) => ({
      toasts: [
        ...s.toasts,
        { id, message: input.message, tone, undoable: input.undo !== undefined },
      ],
    }))
    return id
  },
  undo: async (id) => {
    const run = undos.get(id)
    const failed = undoFailures.get(id)
    get().dismiss(id)
    if (!run) return
    try {
      await run()
      get().show({ message: 'Undone' })
    } catch (error) {
      // A refusal carries its reason (409: "Someone changed this review since…").
      const reason = error instanceof HttpError && error.status < 500 ? error.message : undefined
      get().show({ message: reason ?? failed ?? "Couldn't undo that", tone: 'error' })
    }
  },
  dismiss: (id) => {
    toastManager.close(id)
    forget(id)
  },
  reset: () => {
    toastManager.close()
    undos.clear()
    undoFailures.clear()
    set({ toasts: [] })
  },
}))

function forget(id: string): void {
  undos.delete(id)
  undoFailures.delete(id)
  useToastStore.setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
}

export namespace ToastStore {
  export interface Entry {
    id: string
    message: string
    tone: ToastTone
    undoable: boolean
  }
  export interface State {
    toasts: Entry[]
  }
  export interface Actions {
    /** Opens a toast; returns its ID. */
    show: (input: ToastInput) => string
    /** Runs the toast's undo (after closing it) and says how it went. */
    undo: (id: string) => Promise<void>
    dismiss: (id: string) => void
    reset: () => void
  }
}
