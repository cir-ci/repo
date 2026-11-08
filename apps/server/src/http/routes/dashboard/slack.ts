import type { Slack } from '@circi/api'
import {
  openSecret,
  SLACK_CHANNEL_ID_RE,
  SLACK_EVENTS,
  sealSecret,
  signState,
  slackEventsOf,
  verifyState,
} from '@circi/core'
import {
  createIntegration,
  findSlackIntegration,
  getIntegration,
  getMemberRole,
  getProjectBySlugs,
  listIntegrations,
  listSlackProjectMappings,
  removeIntegrationProject,
  replaceIntegrationCredentials,
  setIntegrationAttention,
  setIntegrationProject,
} from '@circi/db'
import { isSlackRevoked } from '@circi/providers'
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'

import { currentUser } from '#http/hooks/session.ts'
import type { Deps } from '#http/lib/deps.ts'
import { loadOrg } from '#http/lib/org-access.ts'
import { parse } from '#http/lib/validation.ts'

const integrationParams = z.object({ org: z.string(), id: z.uuid() })
const mappingParams = integrationParams.extend({ project: z.string() })
const mappingBody = z.strictObject({
  channelId: z.string().regex(SLACK_CHANNEL_ID_RE, 'That is not a Slack channel id'),
  channelName: z.string().trim().min(1).max(100),
  events: z.array(z.enum(SLACK_EVENTS)).max(SLACK_EVENTS.length),
})
const callbackQuery = z.object({
  code: z.string().optional(),
  state: z.string().optional(),
  error: z.string().optional(),
})

const CALLBACK_PATH = '/integrations/slack/callback'

/**
 * The Slack integration: installing the Slack app into a workspace (OAuth v2), and which channel
 * each project's notices go to. Everyone in the organisation can look at the page; owners and
 * admins connect, choose channels and change events. The messages themselves are sent by the
 * worker's `send-slack` job.
 */
export const dashboardSlackRoutes: FastifyPluginAsync<Deps.Dashboard> = async (app, deps) => {
  const redirectUri = `${deps.publicOrigin}/api${CALLBACK_PATH}`

  async function loadForManager(req: FastifyRequest, reply: FastifyReply) {
    const found = await loadOrg(deps, req, reply)
    if (!found) return undefined
    const role = await getMemberRole(deps.db, {
      userId: found.user.id,
      organizationId: found.org.id,
    })
    if (role !== 'owner' && role !== 'admin') {
      await reply.code(403).send({ error: 'Only owners and admins can manage integrations' })
      return undefined
    }
    return found
  }

  app.get('/orgs/:org/integrations/slack', async (req, reply) => {
    const found = await loadOrg(deps, req, reply)
    if (!found) return reply
    const role = await getMemberRole(deps.db, {
      userId: found.user.id,
      organizationId: found.org.id,
    })
    const payload: Slack.Page = {
      canManage: role === 'owner' || role === 'admin',
      configured: deps.slack !== undefined,
      workspaces: (await listIntegrations(deps.db, found.org.id))
        .filter((i) => i.kind === 'slack')
        .map((i) => ({
          id: i.id,
          name: i.displayName,
          needsAttention: i.needsAttention,
          attentionReason: i.needsAttentionReason,
        })),
      projects: (await listSlackProjectMappings(deps.db, found.org.id)).map((p) => ({
        slug: p.slug,
        name: p.name,
        integrationId: p.integrationId,
        channelId: p.channelId,
        channelName: typeof p.extra?.name === 'string' ? p.extra.name : null,
        events: p.integrationId ? slackEventsOf(p.extra) : [],
      })),
    }
    return payload
  })

  /** The address to send the browser to for installing the Slack app; `state` binds org and user. */
  app.get('/orgs/:org/integrations/slack/install', async (req, reply) => {
    const found = await loadForManager(req, reply)
    if (!found) return reply
    if (!deps.slack || !deps.authSecret) {
      return reply.code(400).send({ error: 'This instance has no Slack app configured' })
    }
    const state = signState(deps.authSecret, {
      orgId: found.org.id,
      orgSlug: found.org.slug,
      userId: found.user.id,
    })
    const payload: Slack.Install = {
      url: deps.slack.client.authorizeUrl({
        clientId: deps.slack.clientId,
        redirectUri,
        state,
      }),
    }
    return payload
  })

  /**
   * Where Slack sends the browser back. The signed `state` must be one this instance issued
   * recently, to this very user, for an organisation they still manage; only then is the code
   * exchanged and the bot token stored (sealed). Installing again for the same workspace
   * replaces the token and clears "needs attention".
   */
  app.get(CALLBACK_PATH, async (req, reply) => {
    const query = parse(callbackQuery, req.query)
    const user = currentUser(req)
    const claims =
      deps.authSecret && query.state ? verifyState(deps.authSecret, query.state) : undefined
    const orgId = claims?.orgId
    const orgSlug = claims?.orgSlug
    if (!deps.slack || !deps.authSecret || !claims || !orgId || !orgSlug) {
      return reply
        .code(400)
        .send({ error: 'This Slack link is invalid or has expired; start again' })
    }
    if (claims.userId !== user.id) {
      return reply.code(400).send({ error: 'This Slack link was started by someone else' })
    }
    const role = await getMemberRole(deps.db, { userId: user.id, organizationId: orgId })
    if (role !== 'owner' && role !== 'admin') {
      return reply.code(403).send({ error: 'Only owners and admins can manage integrations' })
    }
    const back = (result: string) =>
      reply.redirect(
        `/organizations/${encodeURIComponent(orgSlug)}/settings/integrations/slack?slack=${result}`,
      )
    if (query.error || !query.code) return back('denied')
    try {
      const install = await deps.slack.client.exchangeCode({
        clientId: deps.slack.clientId,
        clientSecret: deps.slack.clientSecret,
        code: query.code,
        redirectUri,
      })
      const sealed = sealSecret(deps.authSecret, install.botToken)
      const existing = await findSlackIntegration(deps.db, orgId, install.teamId)
      if (existing) {
        await replaceIntegrationCredentials(deps.db, existing.id, {
          displayName: install.teamName,
          encryptedCredentials: sealed,
        })
      } else {
        await createIntegration(deps.db, {
          orgId,
          kind: 'slack',
          displayName: install.teamName,
          externalId: install.teamId,
          encryptedCredentials: sealed,
          createdBy: user.id,
        })
      }
    } catch (err) {
      req.log.warn({ err }, 'could not finish the Slack install')
      return back('failed')
    }
    return back('connected')
  })

  /** The channels the workspace's bot can see, for choosing a project's channel. */
  app.get('/orgs/:org/integrations/slack/:id/channels', async (req, reply) => {
    const found = await loadForManager(req, reply)
    if (!found) return reply
    const { id } = parse(integrationParams, req.params)
    const integration = await getIntegration(deps.db, found.org.id, id)
    if (!integration || integration.kind !== 'slack') {
      return reply.code(404).send({ error: 'Integration not found' })
    }
    if (!deps.slack || !deps.authSecret) {
      return reply.code(400).send({ error: 'This instance has no Slack app configured' })
    }
    const token = integration.encryptedCredentials
      ? openSecret(deps.authSecret, integration.encryptedCredentials)
      : undefined
    if (!token) {
      return reply
        .code(409)
        .send({ error: 'The Slack token cannot be read; reinstall the Slack app' })
    }
    try {
      const channels: Slack.Channel[] = await deps.slack.client.listChannels(token)
      return { channels }
    } catch (err) {
      if (isSlackRevoked(err)) {
        await setIntegrationAttention(
          deps.db,
          integration.id,
          `Slack rejected the token (${err.code}); reinstall the Slack app`,
        )
        return reply
          .code(409)
          .send({ error: 'Slack no longer accepts this workspace; reinstall the Slack app' })
      }
      req.log.warn({ err }, 'could not list Slack channels')
      return reply.code(502).send({ error: 'Slack did not answer; try again shortly' })
    }
  })

  /** Sends a project's notices to a channel (replacing its earlier one) with the chosen events. */
  app.put('/orgs/:org/integrations/slack/:id/projects/:project', async (req, reply) => {
    const found = await loadForManager(req, reply)
    if (!found) return reply
    const params = parse(mappingParams, req.params)
    const body = parse(mappingBody, req.body)
    const integration = await getIntegration(deps.db, found.org.id, params.id)
    if (!integration || integration.kind !== 'slack') {
      return reply.code(404).send({ error: 'Integration not found' })
    }
    const project = await getProjectBySlugs(deps.db, {
      orgSlug: found.org.slug,
      projectSlug: params.project,
    })
    const events = SLACK_EVENTS.filter((e) => body.events.includes(e))
    await setIntegrationProject(deps.db, {
      integrationId: integration.id,
      projectId: project.id,
      externalRef: body.channelId,
      extra: { name: body.channelName, events },
    })
    return reply.code(204).send()
  })

  /** Stops a project's Slack notices. */
  app.delete('/orgs/:org/integrations/slack/:id/projects/:project', async (req, reply) => {
    const found = await loadForManager(req, reply)
    if (!found) return reply
    const params = parse(mappingParams, req.params)
    const integration = await getIntegration(deps.db, found.org.id, params.id)
    if (!integration || integration.kind !== 'slack') {
      return reply.code(404).send({ error: 'Integration not found' })
    }
    const project = await getProjectBySlugs(deps.db, {
      orgSlug: found.org.slug,
      projectSlug: params.project,
    })
    await removeIntegrationProject(deps.db, integration.id, project.id)
    return reply.code(204).send()
  })
}
