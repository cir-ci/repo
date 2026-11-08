import { createRoute, lazyRouteComponent } from '@tanstack/react-router'

import { rootRoute } from '#app/root-route.ts'

const integrationsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'organizations/$org/settings/integrations',
  component: lazyRouteComponent(() => import('./IntegrationsPage.tsx'), 'IntegrationsPage'),
})

/** Every integration: one page, rendered from its definition's spec. */
const genericRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'organizations/$org/settings/integrations/$kind/$id',
  component: lazyRouteComponent(
    () => import('./GenericIntegrationPage.tsx'),
    'GenericIntegrationPage',
  ),
})

export const integrationsRoutes = [integrationsRoute, genericRoute]
