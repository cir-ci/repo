import type { FastifyPluginAsync } from 'fastify'

import type { DashboardDeps } from '../../deps.ts'
import { jsonErrorHandler } from '../../errors.ts'
import { requireDashboardPassword } from '../../hooks/dashboard-password.ts'
import { dashboardFileRoutes } from './files.ts'
import { dashboardProjectRoutes } from './projects.ts'
import { webAppRoutes } from './web-app.ts'

/**
 * The dashboard: its JSON API under `/api` and the web app on every other path. The password
 * hook covers this whole scope; the CI API (`/v1`) and health checks live outside it.
 */
export const dashboardRoutes: FastifyPluginAsync<DashboardDeps> = async (dash, options) => {
  // Only the dependencies go to children (registration options can carry a `prefix`).
  const deps: DashboardDeps = {
    db: options.db,
    storage: options.storage,
    ...(options.password ? { password: options.password } : {}),
    ...(options.webDist ? { webDist: options.webDist } : {}),
  }
  dash.addHook('onRequest', requireDashboardPassword(deps.password))
  dash.setErrorHandler(jsonErrorHandler)

  await dash.register(dashboardProjectRoutes, { ...deps, prefix: '/api' })
  await dash.register(dashboardFileRoutes, { ...deps, prefix: '/api' })
  // Last: its catch-all serves the app shell for client-side routes.
  await dash.register(webAppRoutes, deps)
}
