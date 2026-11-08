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

export const placeholderRoutes = [
  placeholder('organizations/$org/insights', 'Insights'),
  placeholder('organizations/$org/views/$view', 'View'),
  placeholder('$org/$project/triage', 'Triage'),
  placeholder('$org/$project/baselines', 'Baselines'),
  // Settings pages.
  placeholder('account/notifications', 'Notifications'),
  placeholder('account/appearance', 'Appearance'),
  placeholder('organizations/$org/settings', 'General'),
  placeholder('organizations/$org/settings/integrations', 'Integrations'),
  placeholder('organizations/$org/settings/storage', 'Storage'),
  placeholder('$org/$project/settings/reviews', 'Reviews and triage'),
]
