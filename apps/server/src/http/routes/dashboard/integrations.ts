import type { Integration } from '@circi/api'
import { INSTALLATION_ID_RE } from '@circi/core'
import {
  connectGithub,
  deleteIntegration,
  getGitConnection,
  getMemberRole,
  isInstallationClaimedElsewhere,
  listGitConnections,
  listOrgIntegrations,
  listProjectRepoLinks,
  removeGitConnection,
} from '@circi/db'
import { buildCatalog, integrationRegistry, resolveKind } from '@circi/integrations'
import { isConnectionRevoked } from '@circi/providers'
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'

import { openConnectionCredentials } from '#http/lib/connection-credentials.ts'
import type { Deps } from '#http/lib/deps.ts'
import { integrationContext } from '#http/lib/integration-context.ts'
import { loadOrg } from '#http/lib/org-access.ts'
import { parse } from '#http/lib/validation.ts'

const idParams = z.object({ org: z.string(), id: z.uuid() })
const removeParams = idParams.extend({ source: z.enum(['connection', 'integration']) })
const githubBody = z.strictObject({
  installationId: z.string().regex(INSTALLATION_ID_RE, 'The installation id is a number'),
})

const wire = (i: listOrgIntegrations.Item): Integration.Item => ({
  ...i,
  createdAt: i.createdAt.toISOString(),
})

/**
 * An organisation's integrations: the git hosts and other services it connected. Every member can
 * look; owners and admins add and remove (anyone outside the organisation gets "not found").
 * Integrations of the registry are connected through the generic routes (`integrations-generic.ts`);
 * the kinds not migrated yet (git hosts, trackers, Figma) keep their own routes.
 */
export const dashboardIntegrationRoutes: FastifyPluginAsync<Deps.Dashboard> = async (app, deps) => {
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

  /**
   * Whether an integration that is not in the registry yet can be connected now (GitHub when its
   * App is configured, registered hosts, tokens). Each integration migrated to the SDK leaves this.
   */
  const connectable = (kind: string) =>
    (kind === 'github' && deps.githubApp === true) ||
    (kind === 'figma' && deps.figma !== undefined && deps.authSecret !== undefined) ||
    ((kind === 'linear' || kind === 'jira') && deps.authSecret !== undefined) ||
    deps.providers?.get(kind) !== undefined
  /** Not-yet-migrated kinds with an add flow in this build: GitHub's routes, or a registered provider. */
  const built = (kind: string) =>
    kind === 'github' ||
    kind === 'figma' ||
    kind === 'linear' ||
    kind === 'jira' ||
    deps.providers?.get(kind) !== undefined

  const registry = deps.integrations?.registry ?? integrationRegistry

  app.get('/orgs/:org/integrations', async (req, reply) => {
    const found = await load(req, reply)
    if (!found) return reply
    const payload: Integration.ListResponse = {
      canManage: found.canManage,
      integrations: (
        await listOrgIntegrations(deps.db, found.org.id, (kind) => resolveKind(registry, kind))
      ).map(wire),
      catalog: buildCatalog(
        registry.all(),
        integrationContext(deps) ?? {
          authSecret: '',
          publicOrigin: deps.publicOrigin,
          config: deps.integrations?.config ?? {},
        },
        (e) => ({ built: built(e.kind), connectable: connectable(e.kind) }),
      ).map((e) =>
        // Registered integrations are connectable only on an instance that can seal credentials.
        registry.has(e.kind) && deps.authSecret === undefined
          ? Object.assign({}, e, { connectable: false })
          : e,
      ),
    }
    return payload
  })

  /**
   * Removes a connection (`source` is `connection`) or an integration, as the list's `source`
   * says. A git host's projects stop reporting to it, as when unlinked.
   */
  app.delete('/orgs/:org/integrations/:source/:id', async (req, reply) => {
    const org = await loadForManager(req, reply)
    if (!org) return reply
    const { source, id } = parse(removeParams, req.params)
    const removed =
      source === 'connection'
        ? await removeGitConnection(deps.db, org.id, id)
        : await deleteIntegration(deps.db, org.id, id)
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

  /**
   * Connects a GitHub App installation to the organisation (projects then pick repositories on it).
   * There is no install redirect to prove ownership, so the id is checked instead: GitHub must
   * confirm the App is installed there (a token is minted and its repositories listed), and no
   * other organisation of this instance may already use it. Nothing is stored otherwise.
   */
  app.post('/orgs/:org/integrations/github', async (req, reply) => {
    const org = await loadForManager(req, reply)
    if (!org) return reply
    if (!deps.githubApp) {
      return reply.code(400).send({ error: 'This instance has no GitHub App configured' })
    }
    const { installationId } = parse(githubBody, req.body)
    const github = deps.providers?.get('github')
    if (!github)
      return reply.code(400).send({ error: 'This instance has no GitHub App configured' })
    try {
      await github.listRepositories(installationId)
    } catch (err) {
      if (isConnectionRevoked(err)) {
        return reply
          .code(404)
          .send({ error: 'The GitHub App is not installed with that installation id' })
      }
      req.log.warn({ err }, 'could not verify the installation')
      return reply.code(502).send({ error: 'GitHub did not answer; try again shortly' })
    }
    if (await isInstallationClaimedElsewhere(deps.db, 'github', installationId, org.id)) {
      return reply
        .code(409)
        .send({ error: 'That installation is already connected to another organization' })
    }
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
        openConnectionCredentials(deps.authSecret, connection.encryptedCredentials),
      )
      return { repositories }
    } catch (err) {
      req.log.warn({ err }, 'could not list repositories')
      return reply.code(502).send({ error: 'The git host did not answer; try again shortly' })
    }
  })
}
