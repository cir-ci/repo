import { createRoute, lazyRouteComponent } from '@tanstack/react-router'

import { rootRoute } from '#app/root-route.ts'

const accountRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'account',
  component: lazyRouteComponent(() => import('./AccountPage.tsx'), 'AccountPage'),
})

export const accountRoutes = [accountRoute]
