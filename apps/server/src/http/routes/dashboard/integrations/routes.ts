import type { Integration } from '@circi/api'
import { listWorkspaceIntegrations } from '@circi/db/queries'
import { buildCatalog, integrationRegistry, resolveKind } from '@circi/integrations'
import { removeIntegration } from '@circi/services'
import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'

import { integrationContext } from '#composition/integration-context.ts'
import type { Deps } from '#http/lib/deps.ts'
import { parse } from '#http/lib/validation.ts'
import { loadWorkspace } from '#http/lib/workspace-access.ts'

const idParams = z.object({ workspace: z.string(), id: z.uuid() })

const wire = (i: listWorkspaceIntegrations.Item): Integration.Item => ({
  ...i,
  createdAt: i.createdAt.toISOString(),
})

/**
 * A workspace's integrations (git hosts and other services) and the catalog to add from. Every
 * member can look; owners and admins remove (anyone outside the workspace gets "not found").
 * Connecting and mapping are the generic routes (`integrations-generic.ts`).
 */
export const dashboardIntegrationRoutes: FastifyPluginAsync<Deps.Dashboard> = async (app, deps) => {
  const registry = deps.integrations?.registry ?? integrationRegistry

  app.get('/workspaces/:workspace/integrations', async (req) => {
    const found = await loadWorkspace(deps, req)
    const payload: Integration.ListResponse = {
      canManage: found.canManage,
      integrations: (
        await listWorkspaceIntegrations(deps.db, found.workspace.id, (kind) =>
          resolveKind(registry, kind),
        )
      ).map(wire),
      catalog: buildCatalog(
        registry.all(),
        integrationContext(deps) ?? {
          authSecret: '',
          publicOrigin: deps.publicOrigin,
          config: deps.integrations?.config ?? {},
        },
      ).map((e) =>
        // Registered integrations are connectable only on an instance that can seal credentials.
        registry.has(e.kind) && deps.authSecret === undefined
          ? Object.assign({}, e, { connectable: false })
          : e,
      ),
    }
    return payload
  })

  /** Removes an integration; every project mapped to it stops using it (a git host: stops reporting). */
  app.delete('/workspaces/:workspace/integrations/:id', async (req, reply) => {
    const { workspace } = await loadWorkspace(deps, req, {
      manage: true,
      forbidden: 'Only owners and admins can manage integrations',
    })
    const { id } = parse(idParams, req.params)
    await removeIntegration(deps.db, { workspaceId: workspace.id, integrationId: id })
    return reply.code(204).send()
  })
}
