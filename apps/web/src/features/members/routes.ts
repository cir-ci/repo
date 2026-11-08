import { createRoute, lazyRouteComponent, redirect } from '@tanstack/react-router'

import { rootRoute } from '#app/root-route.ts'

// Four segments under `organizations`, so it can't collide with `$org/$project/…` pages.
const membersRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'organizations/$org/settings/members',
  component: lazyRouteComponent(() => import('./MembersPage.tsx'), 'MembersPage'),
})

// Members used to live at `organizations/$org/members`; old links and bookmarks land on the new page.
const legacyMembersRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'organizations/$org/members',
  beforeLoad: ({ params }) => {
    throw redirect({
      to: '/organizations/$org/settings/members',
      params,
      replace: true,
    })
  },
})

export const membersRoutes = [membersRoute, legacyMembersRoute]
