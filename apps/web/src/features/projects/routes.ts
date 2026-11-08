import { createRoute, lazyRouteComponent } from '@tanstack/react-router'

import { rootRoute } from '../../app/root-route.ts'

// Each page is its own chunk, loaded on first visit (and preloaded when a link is hovered).
const projectsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: lazyRouteComponent(() => import('./ProjectsPage.tsx'), 'ProjectsPage'),
})

const projectRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '$org/$project',
  validateSearch: (search: Record<string, unknown>): { before?: number } => {
    const before = Number(search.before)
    return Number.isInteger(before) && before > 1 ? { before } : {}
  },
  component: lazyRouteComponent(() => import('./ProjectPage.tsx'), 'ProjectPage'),
})

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '$org/$project/settings',
  component: lazyRouteComponent(() => import('./ProjectSettingsPage.tsx'), 'ProjectSettingsPage'),
})

export const projectsRoutes = [projectsRoute, projectRoute, settingsRoute]
