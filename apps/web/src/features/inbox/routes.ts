import { createRoute, lazyRouteComponent } from '@tanstack/react-router'

import { rootRoute } from '../../app/root-route.ts'
import { validateInboxSearch } from './api.ts'

const inboxRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'inbox',
  validateSearch: validateInboxSearch,
  component: lazyRouteComponent(() => import('./InboxPage.tsx'), 'InboxPage'),
})

export const inboxRoutes = [inboxRoute]
