import { createRoute, lazyRouteComponent } from '@tanstack/react-router'

import { rootRoute } from '#app/root-route.ts'

const workspaceGeneralRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'workspaces/$workspace/settings',
  component: lazyRouteComponent(() => import('./WorkspaceGeneralPage.tsx'), 'WorkspaceGeneralPage'),
})

const signInRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'workspaces/$workspace/settings/sign-in',
  component: lazyRouteComponent(() => import('./SignInPage.tsx'), 'SignInPage'),
})

const workspaceStorageRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'workspaces/$workspace/settings/storage',
  component: lazyRouteComponent(() => import('./WorkspaceStoragePage.tsx'), 'WorkspaceStoragePage'),
})

export const workspaceSettingsRoutes = [workspaceGeneralRoute, signInRoute, workspaceStorageRoute]
