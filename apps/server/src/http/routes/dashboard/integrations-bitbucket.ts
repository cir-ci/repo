import type { Integration } from '@circi/api'
import { sealSecret } from '@circi/core'
import {
  connectBitbucket,
  getMemberRole,
  isInstallationClaimedElsewhere,
  linkProjectToBitbucket,
  listBitbucketProjectLinks,
  listGitConnections,
  unlinkBitbucketProject,
} from '@circi/db'
import {
  isConnectionRevoked,
  ProviderApiError,
  serializeBitbucketCredentials,
} from '@circi/providers'
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'

import { bitbucketWebhookSecret } from '#http/lib/bitbucket-secret.ts'
import type { Deps } from '#http/lib/deps.ts'
import { loadOrg } from '#http/lib/org-access.ts'
import { parse } from '#http/lib/validation.ts'

const WORKSPACE_RE = /^[a-z0-9][a-z0-9_-]{0,99}$/
const REPO_RE = /^[a-z0-9][\w-]*\/[\w.-]+$/i

const connectBody = z.strictObject({
  workspace: z
    .string()
    .trim()
    .toLowerCase()
    .regex(WORKSPACE_RE, 'Use the workspace id, e.g. acme (as in bitbucket.org/acme)'),
  token: z.string().trim().min(1, 'Enter an access token').max(4096),
  /** Only for an app password: the Bitbucket username it belongs to. */
  username: z.string().trim().min(1).max(200).optional(),
})
const projectParams = z.object({ org: z.string(), project: z.string() })
const linkBody = z.strictObject({
  connectionId: z.uuid(),
  repoRef: z.string().trim().regex(REPO_RE, 'Use workspace/repository, e.g. acme/web'),
})

/**
 * The Bitbucket Cloud integration: connect a workspace with an access token, and choose which
 * repository each project reports to. Every member can look; owners and admins change things.
 */
export const dashboardBitbucketIntegrationRoutes: FastifyPluginAsync<Deps.Dashboard> = async (
  app,
  deps,
) => {
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

  app.get('/orgs/:org/integrations/bitbucket', async (req, reply) => {
    const found = await load(req, reply)
    if (!found) return reply
    const connections = (await listGitConnections(deps.db, found.org.id)).filter(
      (c) => c.kind === 'bitbucket',
    )
    const payload: Integration.BitbucketPage = {
      canManage: found.canManage,
      webhookUrl: `${deps.publicOrigin}/webhooks/bitbucket`,
      webhookSecret:
        found.canManage && deps.authSecret ? bitbucketWebhookSecret(deps.authSecret) : null,
      connections: connections.map((c) => ({
        id: c.id,
        workspace: c.externalId,
        needsAttention: c.needsAttention !== null,
      })),
      projects: await listBitbucketProjectLinks(deps.db, found.org.id),
    }
    return payload
  })

  /**
   * Connects a workspace. The token is proved by listing the workspace's repositories through the
   * provider (nothing is stored when that fails), and no other organisation of this instance may
   * already use the workspace. The token is stored sealed and never sent back.
   */
  app.post('/orgs/:org/integrations/bitbucket', async (req, reply) => {
    const org = await loadForManager(req, reply)
    if (!org) return reply
    const bitbucket = deps.providers?.get('bitbucket')
    if (!bitbucket || !deps.authSecret) {
      return reply.code(400).send({ error: 'Bitbucket is not available on this instance' })
    }
    const { workspace, token, username } = parse(connectBody, req.body)
    const credentials = serializeBitbucketCredentials({ token, ...(username ? { username } : {}) })
    try {
      await bitbucket.listRepositories(workspace, credentials)
    } catch (err) {
      if (isConnectionRevoked(err)) {
        return reply.code(400).send({ error: 'Bitbucket did not accept that token' })
      }
      if (err instanceof ProviderApiError && (err.status === 403 || err.status === 404)) {
        return reply.code(400).send({
          error:
            err.status === 404
              ? 'Bitbucket has no workspace with that id'
              : 'That token cannot read the workspace’s repositories',
        })
      }
      req.log.warn({ err }, 'could not verify the Bitbucket token')
      return reply.code(502).send({ error: 'Bitbucket did not answer; try again shortly' })
    }
    if (await isInstallationClaimedElsewhere(deps.db, 'bitbucket', workspace, org.id)) {
      return reply
        .code(409)
        .send({ error: 'That workspace is already connected to another organization' })
    }
    const { id } = await connectBitbucket(deps.db, {
      orgId: org.id,
      workspace,
      encryptedCredentials: sealSecret(deps.authSecret, credentials),
    })
    return reply.code(201).send({ id })
  })

  /** Points a project at a repository on one of the organisation's Bitbucket connections. */
  app.put('/orgs/:org/integrations/bitbucket/projects/:project', async (req, reply) => {
    const org = await loadForManager(req, reply)
    if (!org) return reply
    const { project } = parse(projectParams, req.params)
    const body = parse(linkBody, req.body)
    await linkProjectToBitbucket(deps.db, {
      orgId: org.id,
      projectSlug: project,
      connectionId: body.connectionId,
      repoRef: body.repoRef,
    })
    return { repoRef: body.repoRef, connectionId: body.connectionId }
  })

  app.delete('/orgs/:org/integrations/bitbucket/projects/:project', async (req, reply) => {
    const org = await loadForManager(req, reply)
    if (!org) return reply
    const { project } = parse(projectParams, req.params)
    if (!(await unlinkBitbucketProject(deps.db, org.id, project))) {
      return reply.code(404).send({ error: 'Project not found' })
    }
    return reply.code(204).send()
  })
}
