import { createRoute, lazyRouteComponent } from '@tanstack/react-router'

import { rootRoute } from '#app/root-route.ts'

import { validateInsightsSearch } from './api.ts'

export const ROUTE = '/workspaces/$workspace/insights'

const insightsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'workspaces/$workspace/insights',
  validateSearch: validateInsightsSearch,
  component: lazyRouteComponent(() => import('./InsightsPage.tsx'), 'InsightsPage'),
})

export const insightsRoutes = [insightsRoute]
