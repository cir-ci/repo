import { createRoute, lazyRouteComponent } from '@tanstack/react-router'

import { rootRoute } from '#app/root-route.ts'

const instanceRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'instance',
  component: lazyRouteComponent(() => import('./InstancePage.tsx'), 'InstancePage'),
})

/** An app's install return when no workspace was named: pick one. */
const setupRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'integrations/$kind/setup',
  component: lazyRouteComponent(() => import('./GithubSetupPage.tsx'), 'GithubSetupPage'),
})

export const instanceRoutes = [instanceRoute, setupRoute]
