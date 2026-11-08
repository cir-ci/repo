import type { Issue } from '@circi/api'
import { openSecret, ISSUE_LINK_KIND } from '@circi/core'
import {
  getBuildByNumber,
  getIntegration,
  getOrganizationBySlug,
  listBuildLinks,
  listProjectIntegrations,
  setIntegrationAttention,
} from '@circi/db'
import { type IntegrationDefinition, integrationRegistry } from '@circi/integrations'
import { ProviderApiError } from '@circi/providers'
import { createIssueFromBuild, MAX_ISSUE_TITLE_LENGTH } from '@circi/services'
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'

import type { Deps } from '#http/lib/deps.ts'
import { integrationContext } from '#http/lib/integration-context.ts'
import { loadProject } from '#http/lib/project-access.ts'
import { parse } from '#http/lib/validation.ts'

const buildParams = z.object({ org: z.string(), project: z.string(), number: z.string() })
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
 * of the organisation read and create issues. The tracker is called before anything is stored,
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
    reply: FastifyReply,
    integration: { id: string; kind: string },
    definition: IntegrationDefinition | undefined,
    err: ProviderApiError,
  ) {
    const name = definition?.name ?? integration.kind
    const reason = definition?.needsAttention(err)
    if (reason) await setIntegrationAttention(deps.db, integration.id, reason)
    req.log.warn({ err }, 'the issue tracker call failed')
    return reply.code(502).send({ error: `${name} did not accept the request: ${err.message}` })
  }

  async function loadBuild(req: FastifyRequest, reply: FastifyReply) {
    const access = await loadProject(deps, req, reply)
    if (!access) return undefined
    const number = Number(parse(buildParams, req.params).number)
    const build = Number.isInteger(number)
      ? await getBuildByNumber(deps.db, access.project.id, number)
      : undefined
    if (!build) {
      await reply.code(404).send({ error: 'Build not found' })
      return undefined
    }
    return { ...access, build }
  }

  /** The issues created from a build, and the trackers its project files issues in. */
  app.get('/projects/:org/:project/builds/:number/issues', async (req, reply) => {
    const found = await loadBuild(req, reply)
    if (!found) return reply
    const [links, mapped] = await Promise.all([
      listBuildLinks(deps.db, found.build.id, ISSUE_LINK_KIND),
      listProjectIntegrations(deps.db, found.project.id, trackerKinds),
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

  app.post('/projects/:org/:project/builds/:number/issues', async (req, reply) => {
    const found = await loadBuild(req, reply)
    if (!found) return reply
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
      const org = await getOrganizationBySlug(deps.db, found.project.orgSlug)
      const integration = await getIntegration(deps.db, org.id, input.integrationId)
      if (integration) {
        return trackerFailed(req, reply, integration, registry.get(integration.kind), err)
      }
      throw err
    }
  })
}
