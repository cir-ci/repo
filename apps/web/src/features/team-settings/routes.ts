import { createRoute, lazyRouteComponent } from '@tanstack/react-router'

import { rootRoute } from '#app/root-route.ts'

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '$workspace/$team/settings',
  component: lazyRouteComponent(() => import('./TeamSettingsPage.tsx'), 'TeamSettingsPage'),
})

const tokenRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '$workspace/$team/settings/token',
  component: lazyRouteComponent(() => import('./CiTokenPage.tsx'), 'CiTokenPage'),
})

const webhooksRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '$workspace/$team/settings/webhooks',
  component: lazyRouteComponent(() => import('./WebhooksPage.tsx'), 'WebhooksPage'),
})

export const teamSettingsRoutes = [settingsRoute, tokenRoute, webhooksRoute]
