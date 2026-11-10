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

const membersRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '$workspace/$team/settings/members',
  component: lazyRouteComponent(() => import('./TeamMembersPage.tsx'), 'TeamMembersPage'),
})

const sitesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '$workspace/$team/settings/sites',
  component: lazyRouteComponent(
    () => import('./TeamSitesSettingsPage.tsx'),
    'TeamSitesSettingsPage',
  ),
})

// Four segments under `workspaces`: the workspace's list of teams, where a team's settings open from.
const teamsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'workspaces/$workspace/settings/teams',
  component: lazyRouteComponent(() => import('./TeamsSettingsPage.tsx'), 'TeamsSettingsPage'),
})

export const teamSettingsRoutes = [
  settingsRoute,
  membersRoute,
  tokenRoute,
  webhooksRoute,
  sitesRoute,
  teamsRoute,
]
