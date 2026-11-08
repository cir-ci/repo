import { createRoute, lazyRouteComponent } from '@tanstack/react-router'

import { rootRoute } from '#app/root-route.ts'

const viewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'workspaces/$workspace/views/$view',
  component: lazyRouteComponent(() => import('./ViewPage.tsx'), 'ViewPage'),
})

export const viewsRoutes = [viewRoute]
