import { createRoute, lazyRouteComponent } from '@tanstack/react-router'

import { rootRoute } from '#app/root-route.ts'
import { parseBuildsSearch } from '#features/builds/list/builds-filters.ts'

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

export const teamsRoutes = [teamsRoute, teamRoute]
