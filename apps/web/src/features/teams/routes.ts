import { createRoute, lazyRouteComponent } from '@tanstack/react-router'

import { rootRoute } from '#app/root-route.ts'

import { parseBuildsSearch } from './builds-filters.ts'
import { parseIgnoreRegionsSearch } from './ignore-regions-search.ts'

// Each page is its own chunk, loaded on first visit (and preloaded when a link is hovered).
const teamsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: lazyRouteComponent(() => import('./TeamsPage.tsx'), 'TeamsPage'),
})

const teamRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '$workspace/$team',
  validateSearch: parseBuildsSearch,
  component: lazyRouteComponent(() => import('./TeamPage.tsx'), 'TeamPage'),
})

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

const ignoreRegionsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '$workspace/$team/settings/ignore-regions',
  validateSearch: parseIgnoreRegionsSearch,
  component: lazyRouteComponent(() => import('./IgnoreRegionsPage.tsx'), 'IgnoreRegionsPage'),
})

export const teamsRoutes = [
  teamsRoute,
  teamRoute,
  settingsRoute,
  tokenRoute,
  webhooksRoute,
  ignoreRegionsRoute,
]
