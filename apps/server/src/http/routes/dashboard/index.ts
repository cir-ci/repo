import type { FastifyPluginAsync } from 'fastify'

import type { DashboardDeps } from '../../deps.ts'
import { jsonErrorHandler } from '../../errors.ts'
import { requireSameOrigin } from '../../hooks/same-origin.ts'
import { requireSession } from '../../hooks/session.ts'
import { authRoutes } from '../auth.ts'
import { dashboardFileRoutes } from './files.ts'
import { dashboardProjectRoutes } from './projects.ts'
import { dashboardReviewRoutes } from './reviews.ts'
import { webAppRoutes } from './web-app.ts'

/**
 * The dashboard, in three parts:
 *
 *   /api/auth/*   sign-in and sessions, handled by better-auth (public: you sign in here)
 *   /api/*        the dashboard's JSON API, behind the session cookie; anything that changes
 *                 data must also come from the dashboard's own origin (CSRF)
 *   everything else  the web app, public: static files that hold no data, and the app shell
 *                    that shows the sign-in page
 *
 * The CI API (`/v1`) and health checks live outside this scope.
 */
export const dashboardRoutes: FastifyPluginAsync<DashboardDeps> = async (dash, options) => {
  // Only the dependencies go to children (registration options can carry a `prefix`).
  const deps: DashboardDeps = {
    db: options.db,
    auth: options.auth,
    storage: options.storage,
    publicOrigin: options.publicOrigin,
    ...(options.emailLogin ? { emailLogin: true } : {}),
    ...(options.webDist ? { webDist: options.webDist } : {}),
  }
  dash.setErrorHandler(jsonErrorHandler)

  await dash.register(authRoutes, {
    auth: deps.auth,
    publicOrigin: deps.publicOrigin,
    emailLogin: deps.emailLogin === true,
  })
  await dash.register(sessionApi, { ...deps, prefix: '/api' })
  // Last: its catch-all serves the app shell for client-side routes.
  await dash.register(webAppRoutes, deps)
}

/** Everything under `/api` except sign-in needs a signed-in user. */
const sessionApi: FastifyPluginAsync<DashboardDeps> = async (api, options) => {
  // Copy only the dependencies: `options` also carries this scope's `prefix`.
  const deps: DashboardDeps = {
    db: options.db,
    auth: options.auth,
    storage: options.storage,
    publicOrigin: options.publicOrigin,
  }
  api.addHook('onRequest', requireSameOrigin(deps.publicOrigin))
  api.addHook('onRequest', requireSession(deps.auth))
  await api.register(dashboardProjectRoutes, deps)
  await api.register(dashboardReviewRoutes, deps)
  await api.register(dashboardFileRoutes, deps)
}
