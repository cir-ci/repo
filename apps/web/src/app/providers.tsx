import { CirciTheme } from '@circi/ui'
import { QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { type ReactNode, useEffect, useState } from 'react'

import { HttpError } from '#lib/http.ts'
import { createMutationCache } from '#lib/mutation-cache.ts'
import { PERSIST_MAX_AGE } from '#lib/persist-policy.ts'
import { restorePersisted } from '#lib/query-persist.ts'
import { sessionEnded } from '#lib/session-end.ts'
import { readFreshSessionHint } from '#lib/session-hint.ts'
import { ToastHost } from '#lib/ToastHost.tsx'

export function createQueryClient(): QueryClient {
  return new QueryClient({
    // A 401 means the session ended (expired, or signed out in another tab): re-check it, and the
    // app falls back to the sign-in page by itself; the stored cache goes too.
    queryCache: new QueryCache({
      onError: (err, query) => {
        if (!(err instanceof HttpError)) return
        if (err.status === 401) sessionEnded()
        // A 404 or 403 for something shown from memory or from the stored cache is the answer: it
        // is gone, or no longer theirs. Its old data is dropped (and so, at the next write, from
        // the stored cache) instead of staying behind the error.
        if ((err.status === 404 || err.status === 403) && query.state.data !== undefined) {
          query.setState({ data: undefined, dataUpdatedAt: 0 })
        }
      },
    }),
    mutationCache: createMutationCache(),
    defaultOptions: {
      queries: {
        staleTime: 10_000,
        // The stored cache (query-persist.ts) is a day old at most; unobserved data must outlive
        // the usual five minutes or the pages not open right now would drop out of it.
        gcTime: PERSIST_MAX_AGE,
        // Don't retry what won't change on retry (missing build, wrong password…).
        retry: (count, err) => !(err instanceof HttpError && err.status < 500) && count < 2,
      },
    },
  })
}

const queryClient = createQueryClient()

/**
 * The theme and the data cache around the router. When a person was signed in here before, the
 * pages wait for their stored cache (a read of a few milliseconds, under the loading screen), so
 * the first frame already has data; the shell checks the session afterwards.
 */
export function Providers({ children }: Providers.Props) {
  const [restored, setRestored] = useState(() => readFreshSessionHint() === null)
  useEffect(() => {
    const hint = readFreshSessionHint()
    if (!hint) return undefined
    // Never wait on storage for long: a stuck read shows the app from the network instead.
    const giveUp = setTimeout(() => setRestored(true), 1500)
    void restorePersisted(queryClient, hint.id).then(() => setRestored(true))
    return () => clearTimeout(giveUp)
  }, [])
  return (
    <CirciTheme>
      <QueryClientProvider client={queryClient}>{restored ? children : null}</QueryClientProvider>
      <ToastHost />
    </CirciTheme>
  )
}

export namespace Providers {
  export interface Props {
    children: ReactNode
  }
}
