import type { Integration } from '@circi/api'
import { NotFoundError, ValidationError } from '@circi/core'
import { getTeamBySlugs, listWorkspaceTeamMappings } from '@circi/db/queries'
import {
  type IntegrationDefinition,
  mappingExtraSchema,
  normalizeExtra,
  describeDefinition,
} from '@circi/integrations'
import { mapTeam, unmapTeam } from '@circi/services'
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify'

import { integrationContext } from '#composition/integration-context.ts'
import type { Deps } from '#http/lib/deps.ts'
import { parse } from '#http/lib/validation.ts'
import { loadWorkspace } from '#http/lib/workspace-access.ts'

import { createGeneric, credentialsFor } from './context.ts'
import { webhookOf, wireTarget } from './presenters.ts'
import { idParams, mappingBody, mappingParams } from './schemas.ts'

/** The repositories a git host's connection can see, as targets. */
async function listRepositories(
  git: NonNullable<IntegrationDefinition['capabilities']['git']>,
  externalId: string,
  credentials: string,
  ctx: IntegrationDefinition.Context,
): Promise<IntegrationDefinition.Target[]> {
  const provider = git.provider(ctx)
  if (!provider) return []
  const repositories = await provider.listRepositories(externalId, credentials || undefined)
  return repositories.map((r) => ({ id: r.ref, name: r.ref }))
}

/**
 *   GET    /workspaces/:workspace/integrations/:id/targets         what a team can be pointed at
 *   GET    /workspaces/:workspace/integrations/:id/teams        the integration and every team's mapping
 *   PUT    /workspaces/:workspace/integrations/:id/teams/:team   map a team
 *   DELETE /workspaces/:workspace/integrations/:id/teams/:team   stop
 */
export const dashboardIntegrationMappingRoutes: FastifyPluginAsync<Deps.Dashboard> = async (
  app,
  deps,
) => {
  const { loadForManager, integrationFor, contextFor, providerFailed } = createGeneric(deps)

  /** What the integration's account lets a team be pointed at (channels, teams…). */
  const targets = async (req: FastifyRequest) => {
    const found = await loadForManager(req)
    const { id } = parse(idParams, req.params)
    const loaded = await integrationFor(found.workspace.id, id)
    const { definition } = loaded
    const ctx = contextFor()
    const git = definition.capabilities.git
    const isRepository = definition.mapping?.target.kind === 'repository'
    if (!definition.mapping?.listTargets && !(git && isRepository)) {
      throw new NotFoundError(`${definition.name} has no targets to choose from`)
    }
    const credentials = credentialsFor(loaded, ctx)
    try {
      const listed =
        git && isRepository
          ? await listRepositories(git, loaded.integration.externalId, credentials, ctx)
          : ((await definition.mapping?.listTargets?.(credentials, ctx)) ?? [])
      return { targets: listed.map(wireTarget) }
    } catch (err) {
      return providerFailed(req, loaded, err)
    }
  }

  /** Points a team at a target (replacing its earlier one) with the definition's settings. */
  const put = async (req: FastifyRequest, reply: FastifyReply) => {
    const found = await loadForManager(req)
    const params = parse(mappingParams, req.params)
    const loaded = await integrationFor(found.workspace.id, params.id)
    const { integration, definition } = loaded
    const mapping = definition.mapping
    if (!mapping) throw new NotFoundError(`${definition.name} has no team mapping`)
    const body = parse(mappingBody, req.body)
    const invalid = mapping.target.validate?.(body.ref)
    if (invalid) throw new ValidationError(invalid)
    if (mapping.target.kind === 'select' && !body.name) {
      throw new ValidationError(`The ${mapping.target.label.toLowerCase()}'s name is required`)
    }
    const extra = normalizeExtra(mapping, parse(mappingExtraSchema(mapping), body.extra ?? {}))
    const team = await getTeamBySlugs(deps.db, {
      workspaceSlug: found.workspace.slug,
      teamSlug: params.team,
    })
    let target: { ref: string; name?: string | undefined } = {
      ref: body.ref,
      name: body.name ?? (mapping.target.kind === 'repository' ? body.ref : undefined),
    }
    if (mapping.target.resolve) {
      // The definition checks the typed value with the provider and says what to store.
      const ctx = contextFor()
      const credentials = credentialsFor(loaded, ctx)
      try {
        target = await mapping.target.resolve(body.ref, { credentials }, ctx)
      } catch (err) {
        return providerFailed(req, loaded, err)
      }
    }
    await mapTeam(deps.db, {
      definition,
      integrationId: integration.id,
      teamId: team.id,
      ref: target.ref,
      extra: { ...(target.name ? { name: target.name } : {}), ...extra },
    })
    return reply.code(204).send()
  }

  /** Stops a team using the integration. */
  const remove = async (req: FastifyRequest, reply: FastifyReply) => {
    const found = await loadForManager(req)
    const params = parse(mappingParams, req.params)
    const loaded = await integrationFor(found.workspace.id, params.id)
    const team = await getTeamBySlugs(deps.db, {
      workspaceSlug: found.workspace.slug,
      teamSlug: params.team,
    })
    await unmapTeam(deps.db, {
      definition: loaded.definition,
      integrationId: loaded.integration.id,
      teamId: team.id,
    })
    return reply.code(204).send()
  }

  app.get('/workspaces/:workspace/integrations/:id/targets', targets)
  app.put('/workspaces/:workspace/integrations/:id/teams/:team', put)
  app.delete('/workspaces/:workspace/integrations/:id/teams/:team', remove)

  /** The integration, its definition's public spec, and how each team of the workspace maps to it. */
  app.get('/workspaces/:workspace/integrations/:id/teams', async (req) => {
    const found = await loadWorkspace(deps, req)
    const { id } = parse(idParams, req.params)
    const loaded = await integrationFor(found.workspace.id, id)
    const { integration, definition } = loaded
    const { role } = found
    const ctx = integrationContext(deps)
    const payload: Integration.MappingPage = {
      canManage: found.canManage,
      configured: ctx !== undefined && (definition.oauth?.available(ctx) ?? false),
      integration: {
        id: integration.id,
        kind: integration.kind,
        name: integration.displayName,
        needsAttention: integration.needsAttention,
        attentionReason: integration.needsAttentionReason,
      },
      definition: describeDefinition(
        definition,
        ctx ?? { authSecret: '', publicOrigin: deps.publicOrigin, config: {} },
      ),
      webhook: webhookOf(definition, ctx, deps.publicOrigin, role),
      teams: (await listWorkspaceTeamMappings(deps.db, found.workspace.id, integration.id)).map(
        (p) => ({
          slug: p.slug,
          name: p.name,
          mapping: p.mapping
            ? {
                ref: p.mapping.externalRef,
                name: typeof p.mapping.extra.name === 'string' ? p.mapping.extra.name : null,
                extra: p.mapping.extra,
              }
            : null,
        }),
      ),
    }
    return payload
  })
}
