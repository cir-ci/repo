import { createRootRoute } from '@tanstack/react-router'

import { NotFound } from './NotFound.tsx'
import { Shell } from './Shell.tsx'

/**
 * The root of the route tree. It lives apart from `router.tsx` so each feature's `routes.ts` can
 * hang its routes off it without importing the router (which imports them).
 */
export const rootRoute = createRootRoute({ component: Shell, notFoundComponent: NotFound })
