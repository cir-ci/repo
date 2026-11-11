import { createRoute, lazyRouteComponent } from '@tanstack/react-router'

import { rootRoute } from '#app/root-route.ts'

// The bare address is the workspace's hub for instance admins and redirects everyone else to General.
const workspaceSettingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'workspaces/$workspace/settings',
  component: lazyRouteComponent(
    () => import('./WorkspaceSettingsEntry.tsx'),
    'WorkspaceSettingsEntry',
  ),
})

const workspaceGeneralRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'workspaces/$workspace/settings/general',
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

export const workspaceSettingsRoutes = [
  workspaceSettingsRoute,
  workspaceGeneralRoute,
  signInRoute,
  workspaceStorageRoute,
]
