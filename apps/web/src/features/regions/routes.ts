import { createRoute, lazyRouteComponent } from '@tanstack/react-router'

import { rootRoute } from '#app/root-route.ts'

import { parseIgnoreRegionsSearch } from './ignore-regions-search.ts'

const ignoreRegionsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '$workspace/$team/settings/ignore-regions',
  validateSearch: parseIgnoreRegionsSearch,
  component: lazyRouteComponent(() => import('./IgnoreRegionsPage.tsx'), 'IgnoreRegionsPage'),
})

export const regionsRoutes = [ignoreRegionsRoute]
