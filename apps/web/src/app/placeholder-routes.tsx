import { createRoute } from '@tanstack/react-router'

import { ComingSoon } from './ComingSoon.tsx'
import { rootRoute } from './root-route.ts'

/**
 * Pages that are planned and not built yet, each a titled placeholder inside the shell (settings
 * pages get the settings nav too: `Shell` adds it for any settings address). Building one means
 * deleting its line here and declaring the real route in its feature's `routes.ts` (same path).
 */
const placeholder = <const Path extends string>(path: Path, title: string) =>
  createRoute({
    getParentRoute: () => rootRoute,
    path,
    component: () => <ComingSoon title={title} />,
  })

// Nothing is planned-but-unbuilt right now; add `placeholder('path', 'Title')` lines here.
export const placeholderRoutes: ReturnType<typeof placeholder>[] = []
