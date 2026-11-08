import { createRoute, lazyRouteComponent } from '@tanstack/react-router'

import { rootRoute } from '#app/root-route.ts'

import { validateReviewsSearch } from './api.ts'

const reviewsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'workspaces/$workspace/reviews',
  validateSearch: validateReviewsSearch,
  component: lazyRouteComponent(() => import('./ReviewsPage.tsx'), 'ReviewsPage'),
})

export const reviewsRoutes = [reviewsRoute]
