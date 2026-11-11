import type { FastifyPluginAsync } from 'fastify'

import type { Deps } from '#http/lib/deps.ts'

import { dashboardIntegrationConnectRoutes } from './connect.ts'
import { dashboardIntegrationLinkRoutes } from './links.ts'
import { dashboardIntegrationMappingRoutes } from './mapping.ts'
import { dashboardIntegrationOauthRoutes } from './oauth.ts'
import { dashboardIntegrationRoutes as dashboardIntegrationListRoutes } from './routes.ts'

export { dashboardIssueTrackerRoutes } from './issue-trackers.ts'

/**
 * The generic integration routes: every integration of the registry (`@circi/integrations`) is
 * connected, installed and mapped to projects through these, with no route of its own. Everyone
 * in the workspace can look at an integration's mappings; owners and admins connect, choose
 * targets and change settings. The events themselves are delivered by the worker's
 * `integration-event` job.
 */
export const dashboardIntegrationRoutes: FastifyPluginAsync<Deps.Dashboard> = async (app, deps) => {
  await app.register(dashboardIntegrationListRoutes, deps)
  await app.register(dashboardIntegrationMappingRoutes, deps)
  await app.register(dashboardIntegrationLinkRoutes, deps)
  await app.register(dashboardIntegrationConnectRoutes, deps)
  await app.register(dashboardIntegrationOauthRoutes, deps)
}
