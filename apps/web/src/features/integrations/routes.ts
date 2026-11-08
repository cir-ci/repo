import { createRoute, lazyRouteComponent } from '@tanstack/react-router'

import { rootRoute } from '../../app/root-route.ts'

const integrationsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'organizations/$org/settings/integrations',
  component: lazyRouteComponent(() => import('./IntegrationsPage.tsx'), 'IntegrationsPage'),
})

const githubRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'organizations/$org/settings/integrations/github',
  component: lazyRouteComponent(
    () => import('./GithubIntegrationPage.tsx'),
    'GithubIntegrationPage',
  ),
})

export const integrationsRoutes = [integrationsRoute, githubRoute]
