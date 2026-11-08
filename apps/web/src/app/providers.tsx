import { CirciTheme } from '@circi/ui'
import { QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

import { authClient } from '#lib/auth-client.ts'
import { HttpError } from '#lib/http.ts'

export function createQueryClient(): QueryClient {
  return new QueryClient({
    // A 401 means the session ended (expired, or signed out in another tab): re-check it, and the
    // app falls back to the sign-in page by itself.
    queryCache: new QueryCache({
      onError: (err) => {
        if (err instanceof HttpError && err.status === 401) {
          authClient.$store.notify('$sessionSignal')
        }
      },
    }),
    defaultOptions: {
      queries: {
        staleTime: 10_000,
        // Don't retry what won't change on retry (missing build, wrong password…).
        retry: (count, err) => !(err instanceof HttpError && err.status < 500) && count < 2,
      },
    },
  })
}

const queryClient = createQueryClient()

/** The theme and the data cache around the router. */
export function Providers({ children }: Providers.Props) {
  return (
    <CirciTheme>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </CirciTheme>
  )
}

export namespace Providers {
  export interface Props {
    children: ReactNode
  }
}
