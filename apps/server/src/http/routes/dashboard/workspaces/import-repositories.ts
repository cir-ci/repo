import type { Workspace } from '@circi/api'
import { ValidationError } from '@circi/core'
import { importGithubRepositories, listImportableRepositories } from '@circi/services'
import type { FastifyPluginAsync, FastifyRequest } from 'fastify'
import { z } from 'zod'

import { integrationContext } from '#composition/integration-context.ts'
import type { Deps } from '#http/lib/deps.ts'
import { parse } from '#http/lib/validation.ts'
import { loadWorkspace } from '#http/lib/workspace-access.ts'

const importBody = z.strictObject({
  repositories: z
    .array(z.strictObject({ integration: z.uuid(), ref: z.string().trim().min(1).max(1000) }))
    .max(50),
})

/**
 *   GET  /workspaces/:workspace/github-import   the repositories of its GitHub installations no team is linked to
 *   POST /workspaces/:workspace/github-import   one team per picked repository, linked to it
 *
 * Owners and admins. The teams get no CI token; it is issued from the team's settings.
 */
export const dashboardGithubImportRoutes: FastifyPluginAsync<Deps.Dashboard> = async (
  app,
  deps,
) => {
  const load = (req: FastifyRequest) =>
    loadWorkspace(deps, req, {
      manage: true,
      forbidden: 'Only owners and admins can import repositories',
    })

  const contextFor = () => {
    const ctx = integrationContext(deps)
    if (!ctx) throw new ValidationError("This instance can't store credentials")
    return ctx
  }

  app.get('/workspaces/:workspace/github-import', async (req) => {
    const { workspace } = await load(req)
    const repositories = await listImportableRepositories(deps.db, {
      workspaceId: workspace.id,
      ctx: contextFor(),
    })
    const payload: Workspace.GithubRepositories = { repositories }
    return payload
  })

  app.post('/workspaces/:workspace/github-import', async (req, reply) => {
    const { workspace, user } = await load(req)
    const { repositories } = parse(importBody, req.body)
    const result = await importGithubRepositories(deps.db, {
      workspaceId: workspace.id,
      workspaceSlug: workspace.slug,
      userId: user.id,
      repositories,
      ctx: contextFor(),
    })
    const payload: Workspace.GithubImport = result
    return reply.code(201).send(payload)
  })
}
