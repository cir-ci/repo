import { createRoute, lazyRouteComponent } from '@tanstack/react-router'

import { rootRoute } from '#app/root-route.ts'

// The project's settings hub: one row per settings page, grouped. Each page below has its own address.
const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '$workspace/$project/settings',
  component: lazyRouteComponent(
    () => import('./ProjectSettingsHubPage.tsx'),
    'ProjectSettingsHubPage',
  ),
})

const generalRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '$workspace/$project/settings/general',
  component: lazyRouteComponent(() => import('./ProjectSettingsPage.tsx'), 'ProjectSettingsPage'),
})

const tokenRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '$workspace/$project/settings/token',
  component: lazyRouteComponent(() => import('./CiTokenPage.tsx'), 'CiTokenPage'),
})

const webhooksRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '$workspace/$project/settings/webhooks',
  component: lazyRouteComponent(() => import('./WebhooksPage.tsx'), 'WebhooksPage'),
})

const membersRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '$workspace/$project/settings/members',
  component: lazyRouteComponent(() => import('./ProjectMembersPage.tsx'), 'ProjectMembersPage'),
})

const sitesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '$workspace/$project/settings/sites',
  component: lazyRouteComponent(
    () => import('./ProjectsitesSettingsPage.tsx'),
    'ProjectsitesSettingsPage',
  ),
})

// Four segments under `workspaces`: the workspace's list of projects, where a project's settings open from.
const projectsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'workspaces/$workspace/settings/projects',
  component: lazyRouteComponent(() => import('./ProjectsSettingsPage.tsx'), 'ProjectsSettingsPage'),
})

export const projectsettingsRoutes = [
  settingsRoute,
  generalRoute,
  membersRoute,
  tokenRoute,
  webhooksRoute,
  sitesRoute,
  projectsRoute,
]
