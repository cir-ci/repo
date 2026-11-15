import { RESERVED_SLUGS } from '@circi/core'
import { createRoute, lazyRouteComponent, notFound, redirect } from '@tanstack/react-router'

import { rootRoute } from '#app/root-route.ts'
import { parseBuildsSearch } from '#features/builds/list/builds-filters.ts'
import { validateInsightsSearch } from '#features/insights/api.ts'
import { validateReviewsSearch } from '#features/reviews/api.ts'

// Each page is its own chunk, loaded on first visit (and preloaded when a link is hovered).
const projectsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: lazyRouteComponent(() => import('./ProjectsPage.tsx'), 'ProjectsPage'),
})

const projectRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '$workspace/$project',
  validateSearch: parseBuildsSearch,
  // A reserved word can't be a workspace or project (`/acme/insights`, `/workspaces/acme`): that is
  // an unknown page, shown as one, not a project page saying the project doesn't exist.
  beforeLoad: ({ params }) => {
    if (RESERVED_SLUGS.includes(params.workspace) || RESERVED_SLUGS.includes(params.project)) {
      throw notFound()
    }
  },
  component: lazyRouteComponent(() => import('./ProjectPage.tsx'), 'ProjectPage'),
})

// `settings` can't be a project's slug (it is reserved), so `/<workspace>/settings` is a person looking
// for the workspace's settings, not a project called "settings": send them there. A static segment
// outranks `$project`, so this route wins over the project page.
const workspaceSettingsShortcut = createRoute({
  getParentRoute: () => rootRoute,
  path: '$workspace/settings',
  beforeLoad: ({ params }) => {
    throw redirect({
      to: '/workspaces/$workspace/settings',
      params: { workspace: params.workspace },
      replace: true,
    })
  },
})

// The project's Builds list is the project page itself, so `/<workspace>/<project>/builds` (the
// address anyone would guess, next to `/builds/7`) goes there, keeping the filters. `replace` keeps
// Back working.
const buildsListShortcut = createRoute({
  getParentRoute: () => rootRoute,
  path: '$workspace/$project/builds',
  beforeLoad: ({ params }) => {
    throw redirect({
      to: '/$workspace/$project',
      params: { workspace: params.workspace, project: params.project },
      search: true,
      replace: true,
    })
  },
})

// Insights and Reviews are workspace pages (`insights` and `reviews` are reserved project slugs), so a
// project's guessed address goes to the workspace's: Insights filtered to that project, Reviews as is.
const insightsShortcut = createRoute({
  getParentRoute: () => rootRoute,
  path: '$workspace/$project/insights',
  beforeLoad: ({ params }) => {
    throw redirect({
      to: '/workspaces/$workspace/insights',
      params: { workspace: params.workspace },
      search: validateInsightsSearch({ project: params.project }),
      replace: true,
    })
  },
})

const reviewsShortcut = createRoute({
  getParentRoute: () => rootRoute,
  path: '$workspace/$project/reviews',
  beforeLoad: ({ params }) => {
    throw redirect({
      to: '/workspaces/$workspace/reviews',
      params: { workspace: params.workspace },
      search: validateReviewsSearch({}),
      replace: true,
    })
  },
})

export const projectsRoutes = [
  projectsRoute,
  projectRoute,
  workspaceSettingsShortcut,
  buildsListShortcut,
  insightsShortcut,
  reviewsShortcut,
]
