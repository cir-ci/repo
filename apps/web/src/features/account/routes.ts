import { createRoute, lazyRouteComponent, redirect } from '@tanstack/react-router'

import { rootRoute } from '#app/root-route.ts'

const profileRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'account/profile',
  component: lazyRouteComponent(() => import('./ProfilePage.tsx'), 'ProfilePage'),
})

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

const shortcutsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'account/shortcuts',
  component: lazyRouteComponent(() => import('./ShortcutsPage.tsx'), 'ShortcutsPage'),
})

// `/account` used to be the profile page; old links and the sign-in return address land on the new one.
const accountRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'account',
  beforeLoad: () => {
    throw redirect({ to: '/account/profile', replace: true })
  },
})

export const accountRoutes = [
  accountRoute,
  profileRoute,
  notificationsRoute,
  appearanceRoute,
  shortcutsRoute,
]
