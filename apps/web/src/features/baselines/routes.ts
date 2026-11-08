import { createRoute, lazyRouteComponent } from '@tanstack/react-router'

import { rootRoute } from '#app/root-route.ts'

export const ROUTE = '/$workspace/$team/baselines'

const baselinesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '$workspace/$team/baselines',
  component: lazyRouteComponent(() => import('./BaselinesPage.tsx'), 'BaselinesPage'),
})

export const baselinesRoutes = [baselinesRoute]
