import { createRoute, lazyRouteComponent, redirect } from '@tanstack/react-router'

import { rootRoute } from '#app/root-route.ts'

// Four segments under `workspaces`, so it can't collide with `$workspace/$team/…` pages.
const membersRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'workspaces/$workspace/settings/members',
  component: lazyRouteComponent(() => import('./MembersPage.tsx'), 'MembersPage'),
})

// Members used to live at `workspaces/$workspace/members`; old links and bookmarks land on the new page.
const legacyMembersRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'workspaces/$workspace/members',
  beforeLoad: ({ params }) => {
    throw redirect({
      to: '/workspaces/$workspace/settings/members',
      params,
      replace: true,
    })
  },
})

export const membersRoutes = [membersRoute, legacyMembersRoute]
