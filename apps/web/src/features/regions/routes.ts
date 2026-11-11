import { createRoute, lazyRouteComponent, Outlet, redirect } from '@tanstack/react-router'

import { rootRoute } from '#app/root-route.ts'

import { parseIgnoreRegionsSearch } from './ignore-regions-search.ts'
import { ignoreRegionLink } from './links.ts'

/**
 * `/settings/ignore-regions` is the overview, `/settings/ignore-regions/<name>` one screenshot's
 * baseline inside settings (the name is a splat: names contain "/"). They sit under one layout
 * route so the overview is the index: a splat can be empty and would otherwise match first.
 */
const ignoreRegionsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '$workspace/$project/settings/ignore-regions',
  component: Outlet,
})

export const OVERVIEW_ROUTE = '/$workspace/$project/settings/ignore-regions/'
export const BASELINE_ROUTE = '/$workspace/$project/settings/ignore-regions/$'

/**
 * The project settings overview of ignore regions. Old links carry `?name=<screenshot>` (they used
 * to open the editor): they go on to that screenshot's page inside settings, where the regions are.
 */
const overviewRoute = createRoute({
  getParentRoute: () => ignoreRegionsRoute,
  path: '/',
  validateSearch: parseIgnoreRegionsSearch,
  beforeLoad: ({ params, search }) => {
    if (search.name) {
      throw redirect({
        ...ignoreRegionLink(params.workspace, params.project, search.name),
        replace: true,
      })
    }
  },
  component: lazyRouteComponent(() => import('./IgnoreRegionsPage.tsx'), 'IgnoreRegionsPage'),
})

const baselineRoute = createRoute({
  getParentRoute: () => ignoreRegionsRoute,
  path: '$',
  component: lazyRouteComponent(
    () => import('./IgnoreRegionBaselinePage.tsx'),
    'IgnoreRegionBaselinePage',
  ),
})

export const regionsRoutes = [ignoreRegionsRoute.addChildren([overviewRoute, baselineRoute])]
