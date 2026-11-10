import { RESERVED_SLUGS } from '@circi/core'
import { createRoute, lazyRouteComponent, notFound, redirect } from '@tanstack/react-router'

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
  // A reserved word can't be a workspace or team (`/acme/insights`, `/workspaces/acme`): that is
  // an unknown page, shown as one, not a team page saying the team doesn't exist.
  beforeLoad: ({ params }) => {
    if (RESERVED_SLUGS.includes(params.workspace) || RESERVED_SLUGS.includes(params.team)) {
      throw notFound()
    }
  },
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
