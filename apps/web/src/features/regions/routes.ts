import { createRoute, lazyRouteComponent, redirect } from '@tanstack/react-router'

import { rootRoute } from '#app/root-route.ts'
import { baselineLink } from '#features/baselines/links.ts'

import { parseIgnoreRegionsSearch } from './ignore-regions-search.ts'

/**
 * The team settings overview of ignore regions. Old links carry `?name=<screenshot>` (they used
 * to open the editor): they go on to that screenshot's baseline page, where the regions are now.
 */
const ignoreRegionsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '$workspace/$team/settings/ignore-regions',
  validateSearch: parseIgnoreRegionsSearch,
  beforeLoad: ({ params, search }) => {
    if (search.name) {
      throw redirect({ ...baselineLink(params.workspace, params.team, search.name), replace: true })
    }
  },
  component: lazyRouteComponent(() => import('./IgnoreRegionsPage.tsx'), 'IgnoreRegionsPage'),
})

export const regionsRoutes = [ignoreRegionsRoute]
