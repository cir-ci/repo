import type { FastifyPluginAsync } from 'fastify'

import { signFileHashes } from '#http/hooks/file-signatures.ts'
import { requireSameOrigin } from '#http/hooks/same-origin.ts'
import { refuseBlockedProvider, requireSession } from '#http/hooks/session.ts'
import type { Deps } from '#http/lib/deps.ts'
import { jsonErrorHandler } from '#http/lib/errors.ts'
import { authRoutes } from '#http/routes/auth.ts'

import { dashboardAccountEmailRoutes } from './account/email-change.ts'
import { dashboardActivityRoutes } from './builds/activity.ts'
import { dashboardBaselineRoutes } from './builds/baselines.ts'
import { dashboardCommentRoutes } from './builds/comments.ts'
import { dashboardFileRoutes } from './builds/files.ts'
import { dashboardBulkReviewRoutes, dashboardReviewRoutes } from './builds/reviews.ts'
import { dashboardInboxRoutes } from './inbox/inbox.ts'
import { dashboardInsightsRoutes } from './inbox/insights.ts'
import { dashboardReviewRequestRoutes } from './inbox/review-requests.ts'
import { dashboardSearchRoutes } from './inbox/search.ts'
import { dashboardViewRoutes } from './inbox/views.ts'
import { dashboardInstanceAccountRoutes } from './instance/accounts.ts'
import { dashboardGithubAppRoutes } from './instance/github-app.ts'
import { dashboardInstanceHealthRoutes } from './instance/health.ts'
import { dashboardInstanceRoutes } from './instance/notices.ts'
import { dashboardInstanceSettingsRoutes } from './instance/settings.ts'
import { dashboardSetupFinishRoutes } from './instance/setup-finish.ts'
import { dashboardSetupRoutes } from './instance/setup.ts'
import { dashboardInstanceWorkspaceRoutes } from './instance/workspaces.ts'
import { dashboardIntegrationRoutes, dashboardIssueTrackerRoutes } from './integrations/index.ts'
import { dashboardIgnoreRegionRoutes } from './projects/ignore-regions.ts'
import { dashboardProjectMemberRoutes } from './projects/members.ts'
import { dashboardProjectRoutes } from './projects/routes.ts'
import { dashboardRuleRoutes } from './projects/rules.ts'
import { dashboardSettingsRoutes } from './projects/settings.ts'
import { dashboardSiteDomainRoutes } from './projects/site-domains.ts'
import { dashboardSiteHandoffRoutes } from './projects/site-handoff.ts'
import { dashboardProjectSitesRoutes } from './projects/sites.ts'
import { dashboardTriageRoutes } from './projects/triage.ts'
import { dashboardPushRoutes } from './push/push.ts'
import { dashboardUndoRoutes } from './undo.ts'
import { webAppRoutes } from './web-app.ts'
import { dashboardWorkspaceAuthRoutes } from './workspaces/auth.ts'
import { dashboardWorkspaceBuildsRoutes } from './workspaces/builds.ts'
import { dashboardDomainRoutes } from './workspaces/domains.ts'
import { dashboardGithubImportRoutes } from './workspaces/import-repositories.ts'
import { dashboardWorkspacePictureRoutes } from './workspaces/picture.ts'
import { dashboardWorkspaceSettingsRoutes } from './workspaces/settings.ts'
import { dashboardWorkspaceSsoRoutes } from './workspaces/sso.ts'
import { dashboardWorkspaceRoutes } from './workspaces/workspaces.ts'

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
    db: deps.db,
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
      // Outside `sessionApi`: a signed link needs no session (see the route).
      await scope.register(dashboardFileRoutes, deps)
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
  api.addHook('preHandler', refuseBlockedProvider(deps.db))
  if (deps.authSecret) api.addHook('preSerialization', signFileHashes(deps.authSecret))
  await api.register(dashboardProjectRoutes, deps)
  await api.register(dashboardProjectMemberRoutes, deps)
  await api.register(dashboardSettingsRoutes, deps)
  await api.register(dashboardWorkspaceRoutes, deps)
  await api.register(dashboardGithubImportRoutes, deps)
  await api.register(dashboardAccountEmailRoutes, deps)
  await api.register(dashboardInstanceRoutes, deps)
  await api.register(dashboardInstanceAccountRoutes, deps)
  await api.register(dashboardInstanceWorkspaceRoutes, deps)
  await api.register(dashboardInstanceSettingsRoutes, deps)
  await api.register(dashboardInstanceHealthRoutes, deps)
  await api.register(dashboardSetupFinishRoutes, deps)
  await api.register(dashboardGithubAppRoutes, deps)
  await api.register(dashboardWorkspaceAuthRoutes, deps)
  await api.register(dashboardWorkspaceSettingsRoutes, deps)
  await api.register(dashboardWorkspacePictureRoutes, deps)
  await api.register(dashboardDomainRoutes, deps)
  await api.register(dashboardWorkspaceSsoRoutes, deps)
  await api.register(dashboardIntegrationRoutes, deps)
  await api.register(dashboardIssueTrackerRoutes, deps)
  await api.register(dashboardSiteHandoffRoutes, deps)
  await api.register(dashboardProjectSitesRoutes, deps)
  await api.register(dashboardSiteDomainRoutes, deps)
  await api.register(dashboardBulkReviewRoutes, deps)
  await api.register(dashboardReviewRoutes, deps)
  await api.register(dashboardReviewRequestRoutes, deps)
  await api.register(dashboardBaselineRoutes, deps)
  await api.register(dashboardCommentRoutes, deps)
  await api.register(dashboardActivityRoutes, deps)
  await api.register(dashboardInboxRoutes, deps)
  await api.register(dashboardInsightsRoutes, deps)
  await api.register(dashboardPushRoutes, deps)
  await api.register(dashboardRuleRoutes, deps)
  await api.register(dashboardTriageRoutes, deps)
  await api.register(dashboardUndoRoutes, deps)
  await api.register(dashboardIgnoreRegionRoutes, deps)
  await api.register(dashboardSearchRoutes, deps)
  await api.register(dashboardViewRoutes, deps)
  await api.register(dashboardWorkspaceBuildsRoutes, deps)
}
