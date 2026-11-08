import { createRoute, lazyRouteComponent } from '@tanstack/react-router'

import { rootRoute } from '#app/root-route.ts'

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

const workspaceGeneralRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'workspaces/$workspace/settings',
  component: lazyRouteComponent(() => import('./WorkspaceGeneralPage.tsx'), 'WorkspaceGeneralPage'),
})

const workspaceStorageRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'workspaces/$workspace/settings/storage',
  component: lazyRouteComponent(() => import('./WorkspaceStoragePage.tsx'), 'WorkspaceStoragePage'),
})

const reviewsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '$workspace/$team/settings/reviews',
  component: lazyRouteComponent(() => import('./ReviewsSettingsPage.tsx'), 'ReviewsSettingsPage'),
})

export const settingsRoutes = [
  notificationsRoute,
  appearanceRoute,
  workspaceGeneralRoute,
  workspaceStorageRoute,
  reviewsRoute,
]
