import { createRoute, lazyRouteComponent, redirect } from '@tanstack/react-router'

import { rootRoute } from '#app/root-route.ts'

/** `/instance` is the section's front door: Instance settings, with any `?githubApp=` result kept. */
const instanceRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'instance',
  beforeLoad: ({ search }) => {
    throw redirect({ to: '/instance/settings', search, replace: true })
  },
})

const accountsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'instance/accounts',
  component: lazyRouteComponent(() => import('./AccountsPage.tsx'), 'AccountsPage'),
})

const workspacesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'instance/workspaces',
  component: lazyRouteComponent(() => import('./WorkspacesPage.tsx'), 'WorkspacesPage'),
})

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'instance/settings',
  component: lazyRouteComponent(() => import('./InstanceSettingsPage.tsx'), 'InstanceSettingsPage'),
})

const healthRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'instance/health',
  component: lazyRouteComponent(() => import('./HealthPage.tsx'), 'HealthPage'),
})

/** An app's install return when no workspace was named: pick one. */
const setupRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'integrations/$kind/setup',
  component: lazyRouteComponent(() => import('./GithubSetupPage.tsx'), 'GithubSetupPage'),
})

export const instanceRoutes = [
  instanceRoute,
  accountsRoute,
  workspacesRoute,
  settingsRoute,
  healthRoute,
  setupRoute,
]
