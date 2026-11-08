import type { Integration } from '@circi/api'
import { deleteIntegration, getMemberRole, listWorkspaceIntegrations } from '@circi/db'
import { buildCatalog, integrationRegistry, resolveKind } from '@circi/integrations'
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'

import type { Deps } from '#http/lib/deps.ts'
import { integrationContext } from '#http/lib/integration-context.ts'
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
  async function load(req: FastifyRequest, reply: FastifyReply) {
    const found = await loadWorkspace(deps, req, reply)
    if (!found) return undefined
    const role = await getMemberRole(deps.db, {
      userId: found.user.id,
      workspaceId: found.workspace.id,
    })
    return { workspace: found.workspace, canManage: role === 'owner' || role === 'admin' }
  }

  async function loadForManager(req: FastifyRequest, reply: FastifyReply) {
    const found = await load(req, reply)
    if (found && !found.canManage) {
      await reply.code(403).send({ error: 'Only owners and admins can manage integrations' })
      return undefined
    }
    return found?.workspace
  }

  const registry = deps.integrations?.registry ?? integrationRegistry

  app.get('/workspaces/:workspace/integrations', async (req, reply) => {
    const found = await load(req, reply)
    if (!found) return reply
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

  /** Removes an integration; every team mapped to it stops using it (a git host: stops reporting). */
  app.delete('/workspaces/:workspace/integrations/:id', async (req, reply) => {
    const workspace = await loadForManager(req, reply)
    if (!workspace) return reply
    const { id } = parse(idParams, req.params)
    const removed = await deleteIntegration(deps.db, workspace.id, id)
    if (!removed) return reply.code(404).send({ error: 'Integration not found' })
    return reply.code(204).send()
  })
}
