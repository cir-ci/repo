import { AnnouncerProvider, CirciTheme } from '@circi/ui'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  type AnyRouter,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { render } from 'vitest-browser-react'
import { page as browserPage } from 'vitest/browser'

import type { SessionUser } from '#lib/auth-client.ts'
import { createMutationCache } from '#lib/mutation-cache.ts'
import { ToastHost } from '#lib/ToastHost.tsx'

import { setSignedInUser } from './auth-client.ts'
import { type FakeRequest, fakeApi, type ReplyHandler } from './fetch.ts'

export interface RenderPageOptions {
  /** The route's path pattern ("/$workspace/$project/sites"); "/" by default. */
  route?: string
  /** The address to open ("/acme/web/sites?x=1"); the route itself by default. */
  url?: string
  /** Wrap the page in the announcer, for pages that announce loading. */
  announcer?: boolean
  /** The route's search validation, for a page that reads typed search params. */
  validateSearch?: (search: Record<string, unknown>) => unknown
  /** Who the (mocked) auth client is signed in as; `null` for nobody. Ada when left out. */
  user?: SessionUser | null
  /** Dashboard API answers keyed "METHOD /path", as `fakeApi` takes them (faked before render). */
  api?: Record<string, ReplyHandler>
  /** Other route patterns that exist in the app ("/$workspace/$project/builds/$number"), so links to them resolve; they render nothing. */
  otherRoutes?: string[]
  /** The browser viewport ([width, height]) to render at. */
  viewport?: [number, number]
  /** A ready router (e.g. the app's own) to render instead of a single route for `ui`. */
  router?: AnyRouter
  /** Runs after the stores are reset and before the page renders: seed a store or its storage. */
  beforeRender?: () => void | Promise<void>
}

/**
 * Renders `ui` as the component of a route inside the theme, a fresh QueryClient (no retries) and
 * a memory-history router, so page tests share one setup.
 */
export async function renderPage(ui: ReactNode, options: RenderPageOptions = {}) {
  // `setup.ts` puts the stores, storage, fetch and the auth client back after every test.
  if (options.user !== undefined) setSignedInUser(options.user)
  const fake = options.api ? fakeApi(options.api) : undefined
  const calls: FakeRequest[] = fake?.calls ?? []
  if (options.viewport) await browserPage.viewport(...options.viewport)
  await options.beforeRender?.()
  const route = options.route ?? '/'
  const router =
    options.router ??
    (() => {
      const root = createRootRoute({ component: Outlet })
      const page = createRoute({
        getParentRoute: () => root,
        path: route,
        validateSearch: options.validateSearch,
        component: () => ui,
      })
      const others = (options.otherRoutes ?? []).map((path) =>
        createRoute({ getParentRoute: () => root, path, component: () => null }),
      )
      return createRouter({
        routeTree: root.addChildren([page, ...others]),
        history: createMemoryHistory({ initialEntries: [options.url ?? route] }),
      })
    })()
  const queryClient = new QueryClient({
    mutationCache: createMutationCache(),
    defaultOptions: { queries: { retry: false } },
  })
  const routed = (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
  const screen = await render(
    <CirciTheme>
      {options.announcer ? <AnnouncerProvider>{routed}</AnnouncerProvider> : routed}
      <ToastHost />
    </CirciTheme>,
  )
  return { screen, router, queryClient, calls, fake }
}
