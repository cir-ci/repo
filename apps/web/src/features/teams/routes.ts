import { createRoute, lazyRouteComponent, redirect } from '@tanstack/react-router'

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

// `settings` can't be a team's slug (it is reserved), so `/<workspace>/settings` is a person looking
// for the workspace's settings, not a team called "settings": send them there. A static segment
// outranks `$team`, so this route wins over the team page.
const workspaceSettingsShortcut = createRoute({
  getParentRoute: () => rootRoute,
  path: '$workspace/settings',
  beforeLoad: ({ params }) => {
    throw redirect({
      to: '/workspaces/$workspace/settings',
      params: { workspace: params.workspace },
      replace: true,
    })
  },
})

export const teamsRoutes = [teamsRoute, teamRoute, workspaceSettingsShortcut]
