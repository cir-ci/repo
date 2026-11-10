import { HttpError } from '#lib/http.ts'
import { type ToastInput, useToastStore } from '#lib/stores/toast-store.ts'

/**
 * The reason to show after "Couldn't save": the server's own words for a refusal (`HttpError`
 * below 500: "That name is taken"), or the message of a plain `Error` the app threw with a reason
 * to give (the sign-in client's "Mail is down"). Nothing for a failure of ours or of the network
 * (a 500, a `TypeError: Failed to fetch`).
 */
export function failureReason(error: unknown): string | undefined {
  if (error instanceof HttpError)
    return error.status < 500 && error.message ? error.message : undefined
  if (error instanceof Error && error.constructor === Error && error.message) return error.message
  return undefined
}

/** `Couldn't save: That name is taken`, or `Couldn't save` when there is no reason to give. */
export function failureMessage(what: string, error: unknown): string {
  const reason = failureReason(error)
  return reason ? `Couldn't ${what}: ${reason}` : `Couldn't ${what}`
}

/** Shows a toast. `toast('Saved')`, `toast.error(failureMessage('save', error))`. */
export function toast(message: string, options: Omit<ToastInput, 'message' | 'tone'> = {}): string {
  return useToastStore.getState().show({ message, ...options })
}

toast.success = toast

/** Shows a toast from its parts (a message, a tone, an Undo), as `withUndo` builds them. */
toast.show = (input: ToastInput): string => useToastStore.getState().show(input)

/** A failure: a red toast that stays longer. */
toast.error = (message: string): string => useToastStore.getState().show({ message, tone: 'error' })

/** A failure of `what` ("save", "remove the member"), with the reason when the server gave one. */
toast.failed = (what: string, error: unknown): string => toast.error(failureMessage(what, error))

/**
 * A change that can be taken back: `undo` runs when Undo is pressed (the server's undo, or the
 * exact inverse call). It rejects when the change can't be taken back any more.
 */
toast.undoable = (message: string, undo: () => Promise<unknown>, undoFailed?: string): string =>
  useToastStore.getState().show({ message, undo, ...(undoFailed ? { undoFailed } : {}) })

/** What a copy button says when the clipboard answers: `onCopy={copiedToast('Command')}`. */
export const copiedToast = (what: string) => (copied: boolean) =>
  copied ? toast(`${what} copied`) : toast.error(`Couldn't copy the ${what.toLowerCase()}`)

/** The toast helper for components (it holds no state of its own, so it never re-renders). */
export function useToast(): typeof toast {
  return toast
}
