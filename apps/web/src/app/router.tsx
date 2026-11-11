import { createRoute, createRouter, Navigate, type RouterHistory } from '@tanstack/react-router'

import { accountRoutes } from '#features/account/routes.ts'
import { baselinesRoutes } from '#features/baselines/routes.ts'
import { buildsRoutes } from '#features/builds/routes.ts'
import { inboxRoutes } from '#features/inbox/routes.ts'
import { insightsRoutes } from '#features/insights/routes.ts'
import { instanceRoutes } from '#features/instance/routes.ts'
import { integrationsRoutes } from '#features/integrations/routes.ts'
import { membersRoutes } from '#features/members/routes.ts'
import { projectsettingsRoutes } from '#features/project-settings/routes.ts'
import { projectsRoutes } from '#features/projects/routes.ts'
import { regionsRoutes } from '#features/regions/routes.ts'
import { reviewsRoutes } from '#features/reviews/routes.ts'
import { sitesRoutes } from '#features/sites/routes.ts'
import { triageRoutes } from '#features/triage/routes.ts'
import { viewsRoutes } from '#features/views/routes.ts'
import { workspaceSettingsRoutes } from '#features/workspace-settings/routes.ts'

import { rootRoute } from './root-route.ts'
import { WorkspaceRedirect } from './WorkspaceRedirect.tsx'

/** `/reviews` and `/insights` alone belong to a workspace: they open it in the one chosen last, else the first. */
const workspaceRedirects = (['reviews', 'insights'] as const).map((page) =>
  createRoute({
    getParentRoute: () => rootRoute,
    path: page,
    component: () => <WorkspaceRedirect page={page} />,
  }),
)

/**
 * `/login` is the sign-in page, which the shell shows at any address while nobody is signed in;
 * this route only renders for someone who is, and sends them to the app instead of a 404.
 */
const loginRedirect = createRoute({
  getParentRoute: () => rootRoute,
  path: 'login',
  component: () => <Navigate to="/" replace />,
})

/** The route tree: each feature declares its own routes; this only assembles them. */
const routeTree = rootRoute.addChildren([
  ...projectsRoutes,
  ...projectsettingsRoutes,
  ...regionsRoutes,
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
  ...workspaceSettingsRoutes,
  ...integrationsRoutes,
  ...instanceRoutes,
  ...workspaceRedirects,
  loginRedirect,
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
