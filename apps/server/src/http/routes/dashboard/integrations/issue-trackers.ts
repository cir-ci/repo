import type { Issue } from '@circi/api'
import { openSecret, ISSUE_LINK_KIND } from '@circi/core'
import {
  getIntegration,
  getWorkspaceBySlug,
  listBuildLinks,
  listTeamIntegrations,
} from '@circi/db/queries'
import {
  type IntegrationDefinition,
  IntegrationUnreachableError,
  integrationRegistry,
} from '@circi/integrations'
import { ProviderApiError } from '@circi/providers'
import {
  createIssueFromBuild,
  flagFailedIntegration,
  MAX_ISSUE_TITLE_LENGTH,
} from '@circi/services'
import type { FastifyPluginAsync, FastifyRequest } from 'fastify'
import { z } from 'zod'

import { integrationContext } from '#composition/integration-context.ts'
import type { Deps } from '#http/lib/deps.ts'
import { loadBuild } from '#http/lib/team-access.ts'
import { parse } from '#http/lib/validation.ts'

const createBody = z.strictObject({
  integrationId: z.uuid(),
  snapshotName: z.string().min(1).max(500).optional(),
  title: z
    .string()
    .max(MAX_ISSUE_TITLE_LENGTH + 100)
    .optional(),
})

/**
 * Issues created from a build, through the `tracker` capability of the registry's integrations
 * (Linear, Jira, …): connecting and mapping them is generic (`integrations-generic.ts`). Members
 * of the workspace read and create issues. The tracker is called before anything is stored,
 * so a failed call leaves no trace (502).
 */
export const dashboardIssueTrackerRoutes: FastifyPluginAsync<Deps.Dashboard> = async (
  app,
  deps,
) => {
  const registry = deps.integrations?.registry ?? integrationRegistry
  const trackerKinds = registry
    .all()
    .filter((d) => d.capabilities.tracker)
    .map((d) => d.id)

  /** The tracker adapter for an integration's sealed credentials; undefined when they cannot be opened. */
  function openTracker(integration: { kind: string; encryptedCredentials: string | null }) {
    const ctx = integrationContext(deps)
    const tracker = registry.get(integration.kind)?.capabilities.tracker
    if (!ctx || !tracker || !integration.encryptedCredentials) return undefined
    const plaintext = openSecret(ctx.authSecret, integration.encryptedCredentials)
    return plaintext === undefined ? undefined : tracker.create(plaintext, ctx)
  }

  async function trackerFailed(
    req: FastifyRequest,
    integration: { id: string; kind: string },
    definition: IntegrationDefinition | undefined,
    err: ProviderApiError,
  ) {
    const name = definition?.name ?? integration.kind
    await flagFailedIntegration(deps.db, { integrationId: integration.id, definition, error: err })
    req.log.warn({ err }, 'the issue tracker call failed')
    throw new IntegrationUnreachableError(`${name} did not accept the request: ${err.message}`)
  }

  /** The issues created from a build, and the trackers its team files issues in. */
  app.get('/teams/:workspace/:team/builds/:number/issues', async (req) => {
    const found = await loadBuild(deps, req)
    const [links, mapped] = await Promise.all([
      listBuildLinks(deps.db, found.build.id, ISSUE_LINK_KIND),
      listTeamIntegrations(deps.db, found.team.id, trackerKinds),
    ])
    const payload: Issue.List = {
      issues: links.map((l) => {
        const snapshotName = l.payload.snapshotName
        return {
          id: l.id,
          key: l.externalRef,
          url: l.url ?? '',
          title: l.title ?? l.externalRef,
          tracker: l.integrationKind,
          snapshotName: typeof snapshotName === 'string' ? snapshotName : null,
          createdAt: l.createdAt.toISOString(),
          createdBy: l.createdByName,
        }
      }),
      trackers: mapped
        .filter((m) => !m.needsAttention)
        .map((m) => ({
          integrationId: m.integrationId,
          kind: m.kind,
          name: m.displayName,
          target: m.externalRef,
        })),
    }
    return payload
  })

  app.post('/teams/:workspace/:team/builds/:number/issues', async (req, reply) => {
    const found = await loadBuild(deps, req)
    const input = parse(createBody, req.body)
    try {
      const link = await createIssueFromBuild(deps.db, {
        buildId: found.build.id,
        integrationId: input.integrationId,
        snapshotName: input.snapshotName,
        title: input.title,
        userId: found.user.id,
        publicOrigin: deps.publicOrigin,
        openTracker,
      })
      const issue: Issue.Ref = {
        key: link.externalRef,
        url: link.url ?? '',
        title: link.title ?? link.externalRef,
      }
      return reply.code(201).send(issue)
    } catch (err) {
      if (!(err instanceof ProviderApiError)) throw err
      const workspace = await getWorkspaceBySlug(deps.db, found.team.workspaceSlug)
      const integration = await getIntegration(deps.db, workspace.id, input.integrationId)
      if (integration) {
        return trackerFailed(req, integration, registry.get(integration.kind), err)
      }
      throw err
    }
  })
}
