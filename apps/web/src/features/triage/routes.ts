import { createRoute, lazyRouteComponent } from '@tanstack/react-router'

import { rootRoute } from '#app/root-route.ts'

export const ROUTE = '/$workspace/$team/triage'

const triageRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '$workspace/$team/triage',
  component: lazyRouteComponent(() => import('./TriagePage.tsx'), 'TriagePage'),
})

export const triageRoutes = [triageRoute]
