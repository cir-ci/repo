import { createRoute, lazyRouteComponent } from '@tanstack/react-router'

import { rootRoute } from '#app/root-route.ts'

import { validateReviewsSearch } from './api.ts'

const reviewsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'workspaces/$workspace/reviews',
  validateSearch: validateReviewsSearch,
  component: lazyRouteComponent(() => import('./ReviewsPage.tsx'), 'ReviewsPage'),
})

const reviewsSettingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '$workspace/$project/settings/reviews',
  component: lazyRouteComponent(
    () => import('./settings/ReviewsSettingsPage.tsx'),
    'ReviewsSettingsPage',
  ),
})

export const reviewsRoutes = [reviewsRoute, reviewsSettingsRoute]
