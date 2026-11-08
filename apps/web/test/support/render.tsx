import { AnnouncerProvider, CirciTheme } from '@circi/ui'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { render } from 'vitest-browser-react'

import { resetStores } from '#lib/stores/index.ts'

export interface RenderPageOptions {
  /** The route's path pattern ("/$workspace/$team/sites"); "/" by default. */
  route?: string
  /** The address to open ("/acme/web/sites?x=1"); the route itself by default. */
  url?: string
  /** Wrap the page in the announcer, for pages that announce loading. */
  announcer?: boolean
  /** The route's search validation, for a page that reads typed search params. */
  validateSearch?: (search: Record<string, unknown>) => unknown
  /** Runs after the stores are reset and before the page renders: seed a store or its storage. */
  beforeRender?: () => void | Promise<void>
}

/**
 * Renders `ui` as the component of a route inside the theme, a fresh QueryClient (no retries) and
 * a memory-history router, so page tests share one setup.
 */
export async function renderPage(ui: ReactNode, options: RenderPageOptions = {}) {
  // Stores are module singletons: start every page test from their initial state.
  resetStores()
  await options.beforeRender?.()
  const route = options.route ?? '/'
  const root = createRootRoute({ component: Outlet })
  const page = createRoute({
    getParentRoute: () => root,
    path: route,
    validateSearch: options.validateSearch,
    component: () => ui,
  })
  const router = createRouter({
    routeTree: root.addChildren([page]),
    history: createMemoryHistory({ initialEntries: [options.url ?? route] }),
  })
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const routed = (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
  const screen = await render(
    <CirciTheme>
      {options.announcer ? <AnnouncerProvider>{routed}</AnnouncerProvider> : routed}
    </CirciTheme>,
  )
  return { screen, router, queryClient }
}
