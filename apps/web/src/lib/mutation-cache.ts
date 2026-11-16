import { MutationCache } from '@tanstack/react-query'

import { HttpError } from '#lib/http.ts'
import { sessionEnded } from '#lib/session-end.ts'
import { toast } from '#lib/toast.ts'

declare module '@tanstack/react-query' {
  interface Register {
    mutationMeta: {
      /** What the change does, as the end of "Couldn't …" ("save", "remove the member"). */
      what?: string
    }
  }
}

/**
 * Every failed change says so in a toast: "Couldn't save: That name is taken". A form still shows
 * its own field errors in place; the toast is for the action as a whole. A mutation names what it
 * did in `meta.what`. A 401 means the session ended: re-check it, and the app falls back to the
 * sign-in page by itself (and the stored cache goes).
 */
export function createMutationCache(): MutationCache {
  return new MutationCache({
    onError: (error, _variables, _context, mutation) => {
      if (error instanceof HttpError && error.status === 401) sessionEnded()
      toast.failed(mutation.meta?.what ?? 'do that', error)
    },
  })
}
