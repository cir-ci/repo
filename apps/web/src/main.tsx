// Fonts ship with the app: a self-hosted install may have no route to a font service.
// oxlint-disable-next-line import/no-unassigned-import
import '@fontsource-variable/inter'
// oxlint-disable-next-line import/no-unassigned-import
import '@fontsource-variable/jetbrains-mono'
import { CirciTheme } from '@circi/ui'
import { QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from '@tanstack/react-router'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { authClient } from './lib/auth-client.ts'
import { HttpError } from './lib/http.ts'
import { router } from './router.tsx'

const queryClient = new QueryClient({
  // A 401 means the session ended (expired, or signed out in another tab): re-check it, and the
  // app falls back to the sign-in page by itself.
  queryCache: new QueryCache({
    onError: (err) => {
      if (err instanceof HttpError && err.status === 401) authClient.$store.notify('$sessionSignal')
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

const root = document.getElementById('root')
if (!root) throw new Error('#root missing from index.html')
createRoot(root).render(
  <StrictMode>
    <CirciTheme>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </CirciTheme>
  </StrictMode>,
)
