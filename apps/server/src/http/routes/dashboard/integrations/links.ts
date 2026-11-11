import type { Integration } from '@circi/api'
import { NotFoundError, ValidationError } from '@circi/core'
import { findProjectForMember, getProjectBySlugs, listProjectLinks } from '@circi/db/queries'
import { addProjectLink, autoLinkProject, removeProjectLink } from '@circi/services'
import type { FastifyPluginAsync, FastifyRequest } from 'fastify'
import { z } from 'zod'

import type { Deps } from '#http/lib/deps.ts'
import { parse } from '#http/lib/validation.ts'
import { loadWorkspace } from '#http/lib/workspace-access.ts'

import { createGeneric } from './context.ts'
import { wireLink } from './presenters.ts'
import { linkBody, linkParams, mappingParams } from './schemas.ts'

/**
 *   GET    /workspaces/:workspace/integrations/:id/projects/:project/links          the project's links
 *   POST   /workspaces/:workspace/integrations/:id/projects/:project/links          add one
 *   DELETE /workspaces/:workspace/integrations/:id/projects/:project/links/:linkId  remove one
 *   POST   /workspaces/:workspace/integrations/:id/projects/:project/links/auto     link by name
 */
export const dashboardIntegrationLinkRoutes: FastifyPluginAsync<Deps.Dashboard> = async (
  app,
  deps,
) => {
  const { loadForManager, integrationFor, contextFor, providerFailed } = createGeneric(deps)

  /** The integration `:id` and the project `:project` of the workspace, with the definition's links section; throws otherwise. */
  async function linksFor(req: FastifyRequest, options: { manage: boolean }) {
    const found = options.manage ? await loadForManager(req) : await loadWorkspace(deps, req)
    const params = parse(mappingParams, req.params)
    const loaded = await integrationFor(found.workspace.id, params.id)
    if (!loaded.definition.links) throw new NotFoundError(`${loaded.definition.name} has no links`)
    const project = await getProjectBySlugs(deps.db, {
      workspaceSlug: found.workspace.slug,
      projectslug: params.project,
    })
    // Reading a project's links needs the project to be visible: members don't learn of other projects.
    if (!options.manage) {
      const visible = await findProjectForMember(deps.db, {
        workspaceSlug: found.workspace.slug,
        projectslug: params.project,
        userId: found.user.id,
        method: found.user.method,
      })
      if (!visible) throw new NotFoundError('Project not found')
    }
    return { ...loaded, links: loaded.definition.links, project, user: found.user }
  }

  /** A project's links (Figma frames), for every member. */
  app.get('/workspaces/:workspace/integrations/:id/projects/:project/links', async (req) => {
    const found = await linksFor(req, { manage: false })
    const payload: Integration.LinkList = {
      links: (await listProjectLinks(deps.db, found.project.id, found.links.kind))
        .filter((l) => l.integrationId === found.integration.id)
        .map(wireLink),
    }
    return payload
  })

  /** Adds a link from the values of the definition's link fields; the definition checks them with the provider. */
  app.post(
    '/workspaces/:workspace/integrations/:id/projects/:project/links',
    async (req, reply) => {
      const found = await linksFor(req, { manage: true })
      const ctx = contextFor()
      const { values } = parse(linkBody, req.body)
      try {
        const link = await addProjectLink(deps.db, {
          definition: found.definition,
          ctx,
          integration: found.integration,
          projectId: found.project.id,
          values,
          createdBy: found.user.id,
        })
        return reply.code(201).send(wireLink(link))
      } catch (err) {
        if (err instanceof ValidationError) throw err
        return providerFailed(req, found, err)
      }
    },
  )

  app.delete(
    '/workspaces/:workspace/integrations/:id/projects/:project/links/:linkId',
    async (req, reply) => {
      const found = await linksFor(req, { manage: true })
      const { linkId } = parse(linkParams, req.params)
      if (!z.uuid().safeParse(linkId).success) throw new NotFoundError('Link not found')
      await removeProjectLink(deps.db, {
        integrationId: found.integration.id,
        projectId: found.project.id,
        linkId,
      })
      return reply.code(204).send()
    },
  )

  /** Links the project's snapshots to what the mapped target offers, by name; existing links are left alone. */
  app.post('/workspaces/:workspace/integrations/:id/projects/:project/links/auto', async (req) => {
    const found = await linksFor(req, { manage: true })
    const ctx = contextFor()
    try {
      const result: Integration.AutoLinkResult = await autoLinkProject(deps.db, {
        definition: found.definition,
        ctx,
        integration: found.integration,
        projectId: found.project.id,
        createdBy: found.user.id,
      })
      return result
    } catch (err) {
      if (err instanceof ValidationError) throw err
      return providerFailed(req, found, err)
    }
  })
}
