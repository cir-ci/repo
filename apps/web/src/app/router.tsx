import { createRouter, type RouterHistory } from '@tanstack/react-router'

import { accountRoutes } from '../features/account/routes.ts'
import { baselinesRoutes } from '../features/baselines/routes.ts'
import { buildsRoutes } from '../features/builds/routes.ts'
import { inboxRoutes } from '../features/inbox/routes.ts'
import { insightsRoutes } from '../features/insights/routes.ts'
import { membersRoutes } from '../features/members/routes.ts'
import { projectsRoutes } from '../features/projects/routes.ts'
import { reviewsRoutes } from '../features/reviews/routes.ts'
import { settingsRoutes } from '../features/settings/routes.ts'
import { sitesRoutes } from '../features/sites/routes.ts'
import { triageRoutes } from '../features/triage/routes.ts'
import { viewsRoutes } from '../features/views/routes.ts'
import { placeholderRoutes } from './placeholder-routes.tsx'
import { rootRoute } from './root-route.ts'

/** The route tree: each feature declares its own routes; this only assembles them. */
const routeTree = rootRoute.addChildren([
  ...projectsRoutes,
  ...buildsRoutes,
  ...membersRoutes,
  ...sitesRoutes,
  ...inboxRoutes,
  ...reviewsRoutes,
  ...viewsRoutes,
  ...triageRoutes,
  ...insightsRoutes,
  ...baselinesRoutes,
  ...accountRoutes,
  ...settingsRoutes,
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
