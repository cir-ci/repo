import { createRoute, lazyRouteComponent, redirect } from '@tanstack/react-router'

import { rootRoute } from '#app/root-route.ts'

/**
 * `/instance` is the section's front door: the Instance hub. The GitHub App flow ends at
 * `/instance?githubApp=<result>` (the server redirects there), so a bare address with that result
 * goes on to Instance settings, which shows it.
 */
const instanceRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'instance',
  beforeLoad: ({ search }) => {
    const withResult = (search as { githubApp?: unknown }).githubApp !== undefined
    throw withResult
      ? redirect({ to: '/instance/settings', search, replace: true })
      : redirect({ to: '/instance/overview', replace: true })
  },
})

const overviewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'instance/overview',
  component: lazyRouteComponent(() => import('./InstanceHubPage.tsx'), 'InstanceHubPage'),
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
  overviewRoute,
  accountsRoute,
  workspacesRoute,
  settingsRoute,
  healthRoute,
  setupRoute,
]
