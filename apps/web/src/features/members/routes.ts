import { createRoute, lazyRouteComponent } from '@tanstack/react-router'

import { rootRoute } from '../../app/root-route.ts'

// Three segments, so it can't collide with `$org/$project` (two) or a build page (four).
const membersRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'organizations/$org/members',
  component: lazyRouteComponent(() => import('./MembersPage.tsx'), 'MembersPage'),
})

export const membersRoutes = [membersRoute]
