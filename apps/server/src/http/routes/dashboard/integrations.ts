import type { Integration } from '@circi/api'
import { INTEGRATION_CATALOG } from '@circi/core'
import {
  connectGithub,
  deleteIntegration,
  getGitConnection,
  getMemberRole,
  type IntegrationItem,
  listGitConnections,
  listOrgIntegrations,
  listProjectRepoLinks,
  removeGitConnection,
} from '@circi/db'
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'

import type { DashboardDeps } from '../../lib/deps.ts'
import { loadOrg } from '../../lib/org-access.ts'
import { parse } from '../../lib/validation.ts'

const idParams = z.object({ org: z.string(), id: z.uuid() })
const githubBody = z.strictObject({
  installationId: z.string().regex(/^\d{1,20}$/, 'The installation id is a number'),
})

const wire = (i: IntegrationItem): Integration.Item => ({
  ...i,
  createdAt: i.createdAt.toISOString(),
})

/**
 * An organisation's integrations: the git hosts and other services it connected. Every member can
 * look; owners and admins add and remove (anyone outside the organisation gets "not found").
 * Non-git kinds have no add route yet; each one adds its own when its provider is built.
 */
export const dashboardIntegrationRoutes: FastifyPluginAsync<DashboardDeps> = async (app, deps) => {
  async function load(req: FastifyRequest, reply: FastifyReply) {
    const found = await loadOrg(deps, req, reply)
    if (!found) return undefined
    const role = await getMemberRole(deps.db, {
      userId: found.user.id,
      organizationId: found.org.id,
    })
    return { org: found.org, canManage: role === 'owner' || role === 'admin' }
  }

  async function loadForManager(req: FastifyRequest, reply: FastifyReply) {
    const found = await load(req, reply)
    if (found && !found.canManage) {
      await reply.code(403).send({ error: 'Only owners and admins can manage integrations' })
      return undefined
    }
    return found?.org
  }

  /** Kinds this instance can connect now: GitHub when its App is configured, plus registered hosts. */
  const connectable = (kind: string) =>
    (kind === 'github' && deps.githubApp === true) || deps.providers?.get(kind) !== undefined

  app.get('/orgs/:org/integrations', async (req, reply) => {
    const found = await load(req, reply)
    if (!found) return reply
    const payload: Integration.ListResponse = {
      canManage: found.canManage,
      integrations: (await listOrgIntegrations(deps.db, found.org.id)).map(wire),
      catalog: INTEGRATION_CATALOG.map((e) =>
        Object.assign({}, e, { connectable: e.status === 'available' && connectable(e.kind) }),
      ),
    }
    return payload
  })

  /** Removes a connection or integration. A git host's projects stop reporting to it, as when unlinked. */
  app.delete('/orgs/:org/integrations/:id', async (req, reply) => {
    const org = await loadForManager(req, reply)
    if (!org) return reply
    const { id } = parse(idParams, req.params)
    const removed =
      (await removeGitConnection(deps.db, org.id, id)) ||
      (await deleteIntegration(deps.db, org.id, id))
    if (!removed) return reply.code(404).send({ error: 'Integration not found' })
    return reply.code(204).send()
  })

  /** The GitHub integration's page: its installations and which repository each project reports to. */
  app.get('/orgs/:org/integrations/github', async (req, reply) => {
    const found = await load(req, reply)
    if (!found) return reply
    const connections = (await listGitConnections(deps.db, found.org.id)).filter(
      (c) => c.kind === 'github',
    )
    const payload: Integration.GithubPage = {
      canManage: found.canManage,
      configured: deps.githubApp === true,
      webhookUrl: `${deps.publicOrigin}/webhooks/github`,
      connections: connections.map((c) => ({
        id: c.id,
        installationId: c.externalId,
        needsAttention: c.needsAttention !== null,
      })),
      projects: (await listProjectRepoLinks(deps.db, found.org.id)).map((p) => ({
        slug: p.slug,
        name: p.name,
        repoRef: p.repoRef,
        installationId: p.connectionExternalId,
      })),
    }
    return payload
  })

  /** Connects a GitHub App installation to the organisation (projects then pick repositories on it). */
  app.post('/orgs/:org/integrations/github', async (req, reply) => {
    const org = await loadForManager(req, reply)
    if (!org) return reply
    if (!deps.githubApp) {
      return reply.code(400).send({ error: 'This instance has no GitHub App configured' })
    }
    const { installationId } = parse(githubBody, req.body)
    const { id } = await connectGithub(deps.db, org.id, installationId)
    return reply.code(201).send({ id })
  })

  /** What a git connection can see, for choosing a project's repository. */
  app.get('/orgs/:org/integrations/:id/repositories', async (req, reply) => {
    const org = await loadForManager(req, reply)
    if (!org) return reply
    const { id } = parse(idParams, req.params)
    const connection = await getGitConnection(deps.db, org.id, id)
    if (!connection) return reply.code(404).send({ error: 'Integration not found' })
    const provider = deps.providers?.get(connection.kind)
    if (!provider) return reply.code(400).send({ error: 'This host is not configured' })
    try {
      const repositories: Integration.Repository[] = await provider.listRepositories(
        connection.externalId,
      )
      return { repositories }
    } catch (err) {
      req.log.warn({ err }, 'could not list repositories')
      return reply.code(502).send({ error: 'The git host did not answer; try again shortly' })
    }
  })
}
