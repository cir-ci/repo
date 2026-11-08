import { createRouter, type RouterHistory } from '@tanstack/react-router'

import { accountRoutes } from '../features/account/routes.ts'
import { buildsRoutes } from '../features/builds/routes.ts'
import { membersRoutes } from '../features/members/routes.ts'
import { projectsRoutes } from '../features/projects/routes.ts'
import { sitesRoutes } from '../features/sites/routes.ts'
import { placeholderRoutes } from './placeholder-routes.tsx'
import { rootRoute } from './root-route.ts'

/** The route tree: each feature declares its own routes; this only assembles them. */
const routeTree = rootRoute.addChildren([
  ...projectsRoutes,
  ...buildsRoutes,
  ...membersRoutes,
  ...sitesRoutes,
  ...accountRoutes,
  ...placeholderRoutes,
])

/** The router; tests pass a memory `history` so they don't touch the address bar. */
export function createAppRouter(options: { history?: RouterHistory } = {}) {
  return createRouter({
    routeTree,
    defaultPreload: 'intent',
    scrollRestoration: true,
    ...(options.history ? { history: options.history } : {}),
  })
}

export const router = createAppRouter()

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
