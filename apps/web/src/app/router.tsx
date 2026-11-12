import { createRoute, createRouter, Navigate, type RouterHistory } from '@tanstack/react-router'

import { accountRoutes } from '#features/account/routes.ts'
import { baselinesRoutes } from '#features/baselines/routes.ts'
import { buildsRoutes } from '#features/builds/routes.ts'
import { inboxRoutes } from '#features/inbox/routes.ts'
import { insightsRoutes } from '#features/insights/routes.ts'
import { instanceRoutes } from '#features/instance/routes.ts'
import { integrationsRoutes } from '#features/integrations/routes.ts'
import { membersRoutes } from '#features/members/routes.ts'
import { projectSettingsRoutes } from '#features/project-settings/routes.ts'
import { projectsRoutes } from '#features/projects/routes.ts'
import { regionsRoutes } from '#features/regions/routes.ts'
import { reviewsRoutes } from '#features/reviews/routes.ts'
import { sitesRoutes } from '#features/sites/routes.ts'
import { triageRoutes } from '#features/triage/routes.ts'
import { viewsRoutes } from '#features/views/routes.ts'
import { workspaceSettingsRoutes } from '#features/workspace-settings/routes.ts'
import { PageSkeleton } from '#lib/PageSkeleton.tsx'

import { rootRoute } from './root-route.ts'
import { WorkspaceHome, WorkspaceRedirect } from './WorkspaceRedirect.tsx'

/** `/reviews` and `/insights` alone belong to a workspace: they open it in the one chosen last, else the first. */
const workspaceRedirects = (['reviews', 'insights'] as const).map((page) =>
  createRoute({
    getParentRoute: () => rootRoute,
    path: page,
    component: () => <WorkspaceRedirect page={page} />,
  }),
)

/** `/acme` alone opens that workspace's Projects (static first segments like `/inbox` win over it). */
const workspaceHome = createRoute({
  getParentRoute: () => rootRoute,
  path: '$workspace',
  component: WorkspaceHome,
})

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
  ...projectSettingsRoutes,
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
  workspaceHome,
  ...workspaceRedirects,
  loginRedirect,
])

/** The router; tests pass a memory `history` so they don't touch the address bar. */
/**
 * Every page is loaded lazily (lazyRouteComponent): while one loads, the current page stays for
 * 300ms, then the shared skeleton shows, for at least 300ms so it doesn't flicker.
 */
export const PENDING = {
  defaultPendingComponent: PageSkeleton,
  defaultPendingMs: 300,
  defaultPendingMinMs: 300,
} as const

/**
 * Scroll restoration for the window and, on a phone, the content panel (`AppFrame`'s `main#content`
 * scrolls there, not the window): a new page starts the panel at the top, and back/forward put it
 * back (it carries `data-scroll-restoration-id`).
 */
export const SCROLL = {
  scrollRestoration: true,
  scrollToTopSelectors: ['#content'],
}

export function createAppRouter(options: { history?: RouterHistory } = {}) {
  return createRouter({
    routeTree,
    defaultPreload: 'intent',
    ...PENDING,
    ...SCROLL,
    ...(options.history ? { history: options.history } : {}),
  })
}

export const router = createAppRouter()

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
