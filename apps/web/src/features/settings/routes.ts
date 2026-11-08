import { createRoute, lazyRouteComponent } from '@tanstack/react-router'

import { rootRoute } from '../../app/root-route.ts'

const notificationsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'account/notifications',
  component: lazyRouteComponent(() => import('./NotificationsPage.tsx'), 'NotificationsPage'),
})

const appearanceRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'account/appearance',
  component: lazyRouteComponent(() => import('./AppearancePage.tsx'), 'AppearancePage'),
})

const orgGeneralRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'organizations/$org/settings',
  component: lazyRouteComponent(() => import('./OrgGeneralPage.tsx'), 'OrgGeneralPage'),
})

const orgStorageRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'organizations/$org/settings/storage',
  component: lazyRouteComponent(() => import('./OrgStoragePage.tsx'), 'OrgStoragePage'),
})

const reviewsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '$org/$project/settings/reviews',
  component: lazyRouteComponent(() => import('./ReviewsSettingsPage.tsx'), 'ReviewsSettingsPage'),
})

export const settingsRoutes = [
  notificationsRoute,
  appearanceRoute,
  orgGeneralRoute,
  orgStorageRoute,
  reviewsRoute,
]
