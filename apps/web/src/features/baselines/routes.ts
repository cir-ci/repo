import { createRoute, lazyRouteComponent } from '@tanstack/react-router'

import { rootRoute } from '#app/root-route.ts'

export const ROUTE = '/$org/$project/baselines'

const baselinesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '$org/$project/baselines',
  component: lazyRouteComponent(() => import('./BaselinesPage.tsx'), 'BaselinesPage'),
})

export const baselinesRoutes = [baselinesRoute]
