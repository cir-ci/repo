import { createRoute, lazyRouteComponent, Outlet } from '@tanstack/react-router'

import { rootRoute } from '#app/root-route.ts'

/**
 * `/baselines` is the list, `/baselines/<name>` one baseline (the name is a splat, because
 * screenshot names contain "/"). They sit under one layout route, so that the list is the index:
 * a splat can be empty, and `/baselines` alone would otherwise match it before the list.
 */
const baselinesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '$workspace/$project/baselines',
  component: Outlet,
})

export const ROUTE = '/$workspace/$project/baselines/'
export const BASELINE_ROUTE = '/$workspace/$project/baselines/$'

const listRoute = createRoute({
  getParentRoute: () => baselinesRoute,
  path: '/',
  component: lazyRouteComponent(() => import('./BaselinesPage.tsx'), 'BaselinesPage'),
})

const baselineRoute = createRoute({
  getParentRoute: () => baselinesRoute,
  path: '$',
  component: lazyRouteComponent(() => import('./BaselinePage.tsx'), 'BaselinePage'),
})

export const baselinesRoutes = [baselinesRoute.addChildren([listRoute, baselineRoute])]
