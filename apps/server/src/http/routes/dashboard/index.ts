import type { FastifyPluginAsync } from 'fastify'

import { requireSameOrigin } from '#http/hooks/same-origin.ts'
import { requireSession } from '#http/hooks/session.ts'
import type { Deps } from '#http/lib/deps.ts'
import { jsonErrorHandler } from '#http/lib/errors.ts'
import { authRoutes } from '#http/routes/auth.ts'

import { dashboardActivityRoutes } from './activity.ts'
import { dashboardBaselineRoutes } from './baselines.ts'
import { dashboardCommentRoutes } from './comments.ts'
import { dashboardDomainRoutes } from './domains.ts'
import { dashboardFileRoutes } from './files.ts'
import { dashboardGithubAppRoutes } from './github-app.ts'
import { dashboardIgnoreRegionRoutes } from './ignore-regions.ts'
import { dashboardInboxRoutes } from './inbox.ts'
import { dashboardInsightsRoutes } from './insights.ts'
import { dashboardInstanceAccountRoutes } from './instance-accounts.ts'
import { dashboardInstanceHealthRoutes } from './instance-health.ts'
import { dashboardInstanceSettingsRoutes } from './instance-settings.ts'
import { dashboardInstanceWorkspaceRoutes } from './instance-workspaces.ts'
import { dashboardInstanceRoutes } from './instance.ts'
import { dashboardGenericIntegrationRoutes } from './integrations-generic.ts'
import { dashboardIntegrationRoutes } from './integrations.ts'
import { dashboardIssueTrackerRoutes } from './issue-trackers.ts'
import {
  dashboardBulkReviewRoutes,
  dashboardReviewRequestRoutes,
  dashboardReviewRoutes,
} from './reviews.ts'
import { dashboardRuleRoutes } from './rules.ts'
import { dashboardSearchRoutes } from './search.ts'
import { dashboardSettingsRoutes } from './settings.ts'
import { dashboardSetupRoutes } from './setup.ts'
import { dashboardSiteHandoffRoutes } from './site-handoff.ts'
import { dashboardTeamSitesRoutes } from './team-sites.ts'
import { dashboardTeamRoutes } from './teams.ts'
import { dashboardTriageRoutes } from './triage.ts'
import { dashboardViewRoutes } from './views.ts'
import { webAppRoutes } from './web-app.ts'
import { dashboardWorkspaceAuthRoutes } from './workspace-auth.ts'
import { dashboardWorkspaceBuildsRoutes } from './workspace-builds.ts'
import { dashboardWorkspaceSettingsRoutes } from './workspace-settings.ts'
import { dashboardWorkspaceSsoRoutes } from './workspace-sso.ts'
import { dashboardWorkspaceRoutes } from './workspaces.ts'

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
export const dashboardRoutes: FastifyPluginAsync<Deps.Dashboard> = async (dash, options) => {
  // Registered through `scoped()` or a plain `register`, never with a `prefix` of its own, so
  // `options` holds exactly the dependencies and can be handed to every child as is.
  const deps = options
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
  await dash.register(
    async (scope) => {
      await scope.register(sessionApi, deps)
    },
    { prefix: '/api' },
  )
  // Last: its catch-all serves the app shell for client-side routes.
  await dash.register(webAppRoutes, deps)
}

/** Everything under `/api` except sign-in needs a signed-in user. */
const sessionApi: FastifyPluginAsync<Deps.Dashboard> = async (api, deps) => {
  api.addHook('onRequest', requireSameOrigin(deps.publicOrigin))
  api.addHook('onRequest', requireSession(deps.auth, deps.db))
  await api.register(dashboardTeamRoutes, deps)
  await api.register(dashboardSettingsRoutes, deps)
  await api.register(dashboardWorkspaceRoutes, deps)
  await api.register(dashboardInstanceRoutes, deps)
  await api.register(dashboardInstanceAccountRoutes, deps)
  await api.register(dashboardInstanceWorkspaceRoutes, deps)
  await api.register(dashboardInstanceSettingsRoutes, deps)
  await api.register(dashboardInstanceHealthRoutes, deps)
  await api.register(dashboardGithubAppRoutes, deps)
  await api.register(dashboardWorkspaceAuthRoutes, deps)
  await api.register(dashboardWorkspaceSettingsRoutes, deps)
  await api.register(dashboardDomainRoutes, deps)
  await api.register(dashboardWorkspaceSsoRoutes, deps)
  await api.register(dashboardIntegrationRoutes, deps)
  await api.register(dashboardGenericIntegrationRoutes, deps)
  await api.register(dashboardIssueTrackerRoutes, deps)
  await api.register(dashboardSiteHandoffRoutes, deps)
  await api.register(dashboardTeamSitesRoutes, deps)
  await api.register(dashboardBulkReviewRoutes, deps)
  await api.register(dashboardReviewRoutes, deps)
  await api.register(dashboardReviewRequestRoutes, deps)
  await api.register(dashboardBaselineRoutes, deps)
  await api.register(dashboardCommentRoutes, deps)
  await api.register(dashboardActivityRoutes, deps)
  await api.register(dashboardInboxRoutes, deps)
  await api.register(dashboardInsightsRoutes, deps)
  await api.register(dashboardRuleRoutes, deps)
  await api.register(dashboardTriageRoutes, deps)
  await api.register(dashboardIgnoreRegionRoutes, deps)
  await api.register(dashboardSearchRoutes, deps)
  await api.register(dashboardViewRoutes, deps)
  await api.register(dashboardWorkspaceBuildsRoutes, deps)
  await api.register(dashboardFileRoutes, deps)
}
