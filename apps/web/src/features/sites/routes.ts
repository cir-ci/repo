import { createRoute, lazyRouteComponent } from '@tanstack/react-router'

import { rootRoute } from '#app/root-route.ts'

const sitesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '$workspace/$team/sites',
  component: lazyRouteComponent(() => import('./TeamSitesPage.tsx'), 'TeamSitesPage'),
})

// Where a hosted site sends people to sign in. Two static segments beat `$workspace/$team`.
const siteHandoffRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '_sso/site',
  validateSearch: (search: Record<string, unknown>): { host?: string; return?: string } => ({
    ...(typeof search.host === 'string' ? { host: search.host } : {}),
    ...(typeof search.return === 'string' ? { return: search.return } : {}),
  }),
  component: lazyRouteComponent(() => import('./SiteHandoffPage.tsx'), 'SiteHandoffPage'),
})

export const sitesRoutes = [sitesRoute, siteHandoffRoute]
