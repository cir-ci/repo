import type { Team } from '@circi/api'
import { deleteTeamWithToken, rotateTeamToken } from '@circi/auth'
import {
  checkWebhookEvents,
  NotFoundError,
  ValidationError,
  WEBHOOK_EVENTS,
  webhookUrlProblem,
} from '@circi/core'
import { getWorkspaceSettings, getTeamById, teamSettings } from '@circi/db'
import {
  addWebhook,
  changeTeamSettings,
  linkTeamToGithub,
  removeWebhook,
  sendTestWebhook,
  unlinkTeamFromGit,
  updateTeamAppearance,
} from '@circi/services'
import type { FastifyPluginAsync, FastifyRequest } from 'fastify'
import { z } from 'zod'

import { githubConfigured } from '#composition/github-app.ts'
import { integrationContext } from '#composition/integration-context.ts'
import { currentUser } from '#http/hooks/session.ts'
import type { Deps } from '#http/lib/deps.ts'
import { loadTeam } from '#http/lib/team-access.ts'
import { parse } from '#http/lib/validation.ts'

import { githubLink, present, presentWebhooks, tokenInfo } from './presenters.ts'
import {
  appearanceBody,
  githubBody,
  hookParams,
  settingsBody,
  teamParams,
  webhookBody,
} from './schemas.ts'

/**
 * A team's settings and webhooks. Every member can look; owners and admins can change
 * things, and anyone outside the workspace gets "not found" like everywhere else.
 */
export const dashboardSettingsRoutes: FastifyPluginAsync<Deps.Dashboard> = async (app, deps) => {
  const allowPrivate = deps.webhookAllowPrivate === true

  async function teamRow(teamId: string) {
    const team = await getTeamById(deps.db, teamId)
    if (!team) throw new NotFoundError('Team not found')
    return team
  }

  async function load(req: FastifyRequest) {
    const found = await loadTeam(deps, req)
    return { team: await teamRow(found.team.id), canManage: found.canManage }
  }

  async function loadForManager(req: FastifyRequest) {
    const found = await loadTeam(deps, req, {
      manage: true,
      forbidden: 'Only owners and admins can change team settings',
    })
    return teamRow(found.team.id)
  }

  app.get('/teams/:workspace/:team/settings', async (req) => {
    const found = await load(req)
    return {
      canManage: found.canManage,
      settings: teamSettings(found.team),
      appearance: { color: found.team.color, icon: found.team.icon },
      // What a team that inherits gets, so the form can say so.
      workspace: await getWorkspaceSettings(deps.db, found.team.workspaceId),
      webhooks: await presentWebhooks(deps.db, found.team.id),
      webhookEvents: WEBHOOK_EVENTS,
      sitesConfigured: deps.sites !== undefined,
      github: {
        configured: githubConfigured(deps),
        webhookUrl: `${deps.publicOrigin}/webhooks/github`,
        link: await githubLink(deps.db, found.team.id),
      },
    }
  })

  app.patch('/teams/:workspace/:team/settings', async (req) => {
    const team = await loadForManager(req)
    const patch = parse(settingsBody, req.body)
    return { settings: await changeTeamSettings(deps.db, team.id, patch) }
  })

  /** Deletes the team and everything that belongs to it (owners and admins). */
  app.delete('/teams/:workspace/:team', async (req, reply) => {
    const team = await loadForManager(req)
    await deleteTeamWithToken(deps.db, team.id)
    return reply.code(204).send()
  })

  /** The tile colour and icon (owners and admins). */
  app.patch('/teams/:workspace/:team/appearance', async (req) => {
    const team = await loadForManager(req)
    const patch = parse(appearanceBody, req.body)
    return { appearance: await updateTeamAppearance(deps.db, team.id, patch) }
  })

  /** Facts about the team's current CI token (members may look); never the token itself. */
  app.get('/teams/:workspace/:team/token', async (req): Promise<Team.Token | void> => {
    const found = await load(req)
    return tokenInfo(deps.db, found.team.id, found.canManage)
  })

  /** A new CI token. The old one stops working at once; the new one is shown only here. */
  app.post('/teams/:workspace/:team/token', async (req): Promise<Team.TokenRotated | void> => {
    const team = await loadForManager(req)
    const p = parse(teamParams, req.params)
    const issued = await rotateTeamToken(deps.auth, deps.db, {
      workspaceSlug: p.workspace,
      teamSlug: team.slug,
      rotatedBy: currentUser(req).id,
    })
    return { token: issued.token, info: await tokenInfo(deps.db, team.id, true) }
  })

  app.put('/teams/:workspace/:team/github', async (req, reply) => {
    const team = await loadForManager(req)
    if (!githubConfigured(deps))
      throw new ValidationError('This instance has no GitHub App configured')
    const link = parse(githubBody, req.body)
    const ctx = integrationContext(deps)
    if (!ctx) return reply.code(400).send({ error: 'This instance cannot store credentials' })
    // Verified with GitHub like the integration's Add flow: nothing is stored when it fails.
    await linkTeamToGithub(deps.db, team.id, link, ctx)
    return { link: { ...link, attention: null } }
  })

  app.delete('/teams/:workspace/:team/github', async (req, reply) => {
    const team = await loadForManager(req)
    await unlinkTeamFromGit(deps.db, team.id)
    return reply.code(204).send()
  })

  app.post('/teams/:workspace/:team/webhooks', async (req, reply) => {
    const team = await loadForManager(req)
    const body = parse(webhookBody, req.body)
    const url = body.url.trim()
    const problem = webhookUrlProblem(url, { allowPrivate })
    if (problem) throw new ValidationError(problem)
    const events = checkWebhookEvents(body.events ?? [])
    const created = await addWebhook(deps.db, {
      teamId: team.id,
      url: new URL(url).toString(),
      events,
    })
    return reply.code(201).send({ webhook: present(created), secret: created.secret })
  })

  /**
   * Queues a signed test event to one webhook (owners and admins). It goes through the delivery
   * job like a build event, so it shows in the webhook's recent deliveries once it has run.
   */
  app.post('/teams/:workspace/:team/webhooks/:id/test', async (req, reply) => {
    const team = await loadForManager(req)
    const { id } = parse(hookParams, req.params)
    if (!z.uuid().safeParse(id).success) return reply.code(404).send({ error: 'Webhook not found' })
    const deliveryId = await sendTestWebhook(deps.db, team.id, id)
    return reply.code(202).send({ deliveryId })
  })

  app.delete('/teams/:workspace/:team/webhooks/:id', async (req, reply) => {
    const team = await loadForManager(req)
    const { id } = parse(hookParams, req.params)
    // A malformed id can't match a row; keep the database from rejecting it as a bad uuid.
    if (!z.uuid().safeParse(id).success) return reply.code(404).send({ error: 'Webhook not found' })
    await removeWebhook(deps.db, team.id, id)
    return reply.code(204).send()
  })
}
