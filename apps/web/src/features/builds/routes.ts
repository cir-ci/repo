import { createRoute, lazyRouteComponent } from '@tanstack/react-router'

import { rootRoute } from '../../app/root-route.ts'
import { validateBuildSearch } from './search.ts'

export { type BuildSearch, ROUTE, type ViewMode } from './search.ts'

export const buildRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '$org/$project/builds/$number',
  validateSearch: validateBuildSearch,
  component: lazyRouteComponent(() => import('./BuildPage.tsx'), 'BuildPage'),
})

export const buildsRoutes = [buildRoute]
