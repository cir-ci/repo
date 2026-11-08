import type { Integration } from '@circi/api'
import { sealSecret, webhookUrlProblem } from '@circi/core'
import {
  connectGitlab,
  getMemberRole,
  isInstallationClaimedElsewhere,
  linkProjectToGitlab,
  listGitConnections,
  listGitlabProjectLinks,
  unlinkGitlabProject,
} from '@circi/db'
import {
  gitlabCredentials,
  gitlabExternalId,
  isConnectionRevoked,
  normalizeGitlabBaseUrl,
  ProviderApiError,
} from '@circi/providers'
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'

import type { Deps } from '#http/lib/deps.ts'
import { gitlabWebhookSecret } from '#http/lib/gitlab-secret.ts'
import { loadOrg } from '#http/lib/org-access.ts'
import { parse } from '#http/lib/validation.ts'

const connectBody = z.strictObject({
  baseUrl: z.string().trim().min(1, 'Enter the GitLab address').max(512),
  token: z.string().trim().min(1, 'Enter an access token').max(4096),
})
const projectParams = z.object({ org: z.string(), project: z.string() })
const linkBody = z.strictObject({
  connectionId: z.uuid(),
  repoRef: z
    .string()
    .trim()
    .regex(/^[\w.-]+(\/[\w.-]+)+$/, 'Use the project path with its namespace, e.g. acme/web'),
})

/**
 * The GitLab integration: connect a GitLab instance (gitlab.com or self-managed) with an access
 * token, and choose which GitLab project each CirCI project reports to. Every member can look;
 * owners and admins change things.
 */
export const dashboardGitlabIntegrationRoutes: FastifyPluginAsync<Deps.Dashboard> = async (
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

  app.get('/orgs/:org/integrations/gitlab', async (req, reply) => {
    const found = await load(req, reply)
    if (!found) return reply
    const connections = (await listGitConnections(deps.db, found.org.id)).filter(
      (c) => c.kind === 'gitlab',
    )
    const payload: Integration.GitlabPage = {
      canManage: found.canManage,
      webhookUrl: `${deps.publicOrigin}/webhooks/gitlab`,
      webhookSecret:
        found.canManage && deps.authSecret ? gitlabWebhookSecret(deps.authSecret) : null,
      connections: connections.map((c) => ({
        id: c.id,
        name: c.externalId,
        needsAttention: c.needsAttention !== null,
      })),
      projects: await listGitlabProjectLinks(deps.db, found.org.id),
    }
    return payload
  })

  /**
   * Connects a GitLab instance with a project, group or personal access token (scope `api`). The
   * token is proved by asking GitLab who it is and listing the projects it can see, through the
   * provider; nothing is stored when that fails (400 for an address or token GitLab refuses, 502
   * when it does not answer). The same instance and token principal cannot belong to two
   * organisations (409). The address and token are stored sealed, and never sent back.
   */
  app.post('/orgs/:org/integrations/gitlab', async (req, reply) => {
    const org = await loadForManager(req, reply)
    if (!org) return reply
    const gitlab = deps.gitlab
    if (!gitlab || !deps.authSecret) {
      return reply.code(400).send({ error: 'GitLab is not available on this instance' })
    }
    const body = parse(connectBody, req.body)
    const baseUrl = normalizeGitlabBaseUrl(body.baseUrl)
    if (!baseUrl) {
      return reply.code(400).send({ error: 'Enter the GitLab address, e.g. https://gitlab.com' })
    }
    const problem = webhookUrlProblem(baseUrl, { allowPrivate: deps.webhookAllowPrivate === true })
    if (problem) return reply.code(400).send({ error: problem })
    const credentials = gitlabCredentials(baseUrl, body.token)
    let externalId: string
    try {
      const me = await gitlab.identify(credentials)
      await gitlab.listRepositories('', credentials)
      externalId = gitlabExternalId(baseUrl, me.id)
    } catch (err) {
      if (isConnectionRevoked(err)) {
        return reply.code(400).send({ error: 'GitLab did not accept that token' })
      }
      if (err instanceof ProviderApiError && (err.status === 403 || err.status === 404)) {
        return reply.code(400).send({
          error:
            err.status === 403
              ? 'That token cannot read projects: give it the api scope'
              : 'That address does not look like a GitLab server',
        })
      }
      req.log.warn({ err }, 'could not verify the GitLab token')
      return reply.code(502).send({ error: 'GitLab did not answer; try again shortly' })
    }
    if (await isInstallationClaimedElsewhere(deps.db, 'gitlab', externalId, org.id)) {
      return reply
        .code(409)
        .send({ error: 'That GitLab account is already connected to another organization' })
    }
    const { id } = await connectGitlab(
      deps.db,
      org.id,
      externalId,
      sealSecret(deps.authSecret, credentials),
    )
    return reply.code(201).send({ id })
  })

  /** Points a project at a GitLab project on one of the organisation's GitLab connections. */
  app.put('/orgs/:org/integrations/gitlab/projects/:project', async (req, reply) => {
    const org = await loadForManager(req, reply)
    if (!org) return reply
    const { project } = parse(projectParams, req.params)
    const body = parse(linkBody, req.body)
    const linked = await linkProjectToGitlab(deps.db, org.id, project, body)
    if (!linked) return reply.code(404).send({ error: 'Project or integration not found' })
    return { repoRef: body.repoRef, connectionId: body.connectionId }
  })

  app.delete('/orgs/:org/integrations/gitlab/projects/:project', async (req, reply) => {
    const org = await loadForManager(req, reply)
    if (!org) return reply
    const { project } = parse(projectParams, req.params)
    if (!(await unlinkGitlabProject(deps.db, org.id, project))) {
      return reply.code(404).send({ error: 'Project not found' })
    }
    return reply.code(204).send()
  })
}
