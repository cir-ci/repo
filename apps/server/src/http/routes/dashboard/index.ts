import type { FastifyPluginAsync } from 'fastify'

import type { DashboardDeps } from '../../deps.ts'
import { jsonErrorHandler } from '../../errors.ts'
import { requireSameOrigin } from '../../hooks/same-origin.ts'
import { requireSession } from '../../hooks/session.ts'
import { authRoutes } from '../auth.ts'
import { dashboardDomainRoutes } from './domains.ts'
import { dashboardFileRoutes } from './files.ts'
import { dashboardInstanceRoutes } from './instance.ts'
import { dashboardOrgAuthRoutes } from './org-auth.ts'
import { dashboardOrganizationRoutes } from './organizations.ts'
import { dashboardProjectRoutes } from './projects.ts'
import { dashboardReviewRoutes } from './reviews.ts'
import { dashboardSettingsRoutes } from './settings.ts'
import { dashboardSetupRoutes } from './setup.ts'
import { webAppRoutes } from './web-app.ts'

/**
 * Only the dependencies go to child plugins: Fastify's registration options also carry a
 * `prefix`, which would leak into everything they register. One list, so none can be forgotten.
 */
function dependenciesOf(options: DashboardDeps): DashboardDeps {
  return {
    db: options.db,
    auth: options.auth,
    storage: options.storage,
    publicOrigin: options.publicOrigin,
    ...(options.emailLogin ? { emailLogin: true } : {}),
    ...(options.passwordLogin === false ? { passwordLogin: false } : {}),
    ...(options.sso?.length ? { sso: options.sso } : {}),
    ...(options.webhookAllowPrivate ? { webhookAllowPrivate: true } : {}),
    ...(options.orgCreation ? { orgCreation: options.orgCreation } : {}),
    ...(options.githubApp ? { githubApp: true } : {}),
    ...(options.authSecret ? { authSecret: options.authSecret } : {}),
    ...(options.resolveTxt ? { resolveTxt: options.resolveTxt } : {}),
    ...(options.webDist ? { webDist: options.webDist } : {}),
  }
}

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
  const deps = dependenciesOf(options)
  dash.setErrorHandler(jsonErrorHandler)

  await dash.register(authRoutes, {
    auth: deps.auth,
    publicOrigin: deps.publicOrigin,
    emailLogin: deps.emailLogin === true,
    passwordLogin: deps.passwordLogin !== false,
    sso: deps.sso ?? [],
  })
  if (deps.authSecret) {
    await dash.register(dashboardSetupRoutes, {
      db: deps.db,
      auth: deps.auth,
      publicOrigin: deps.publicOrigin,
      secret: deps.authSecret,
    })
  }
  await dash.register(sessionApi, { ...deps, prefix: '/api' })
  // Last: its catch-all serves the app shell for client-side routes.
  await dash.register(webAppRoutes, deps)
}

/** Everything under `/api` except sign-in needs a signed-in user. */
const sessionApi: FastifyPluginAsync<DashboardDeps> = async (api, options) => {
  const deps = dependenciesOf(options)
  api.addHook('onRequest', requireSameOrigin(deps.publicOrigin))
  api.addHook('onRequest', requireSession(deps.auth, deps.db))
  await api.register(dashboardProjectRoutes, deps)
  await api.register(dashboardSettingsRoutes, deps)
  await api.register(dashboardOrganizationRoutes, deps)
  await api.register(dashboardInstanceRoutes, deps)
  await api.register(dashboardOrgAuthRoutes, deps)
  await api.register(dashboardDomainRoutes, deps)
  await api.register(dashboardReviewRoutes, deps)
  await api.register(dashboardFileRoutes, deps)
}
