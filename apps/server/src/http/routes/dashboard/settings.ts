import type { Team } from '@circi/api'
import { deleteTeamWithToken, rotateTeamToken } from '@circi/auth'
import { INSTALLATION_ID_RE, ValidationError, webhookUrlProblem } from '@circi/core'
import {
  createWebhook,
  type Database,
  deleteWebhook,
  findTeamForMember,
  getWorkspaceSettings,
  getTeamById,
  getTeamGitAttention,
  getTeamLink,
  getTeamMemberRole,
  getTeamTokenInfo,
  isWebhookEvent,
  listWebhooks,
  teamSettings,
  updateTeamSettings,
  WEBHOOK_EVENTS,
  type Webhook,
} from '@circi/db'
import {
  gitKinds,
  linkTeamToGithub,
  unlinkTeamFromGit,
  updateTeamAppearance,
} from '@circi/services'
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'

import { currentUser } from '#http/hooks/session.ts'
import type { Deps } from '#http/lib/deps.ts'
import { githubConfigured } from '#http/lib/github-app.ts'
import { parse } from '#http/lib/validation.ts'

const teamParams = z.object({ workspace: z.string(), team: z.string() })
const hookParams = teamParams.extend({ id: z.string() })

const settingsBody = z
  .object({
    name: z.string().max(100),
    defaultBranch: z.string().max(255),
    diffThreshold: z.number(),
    autoApproveDefaultBranch: z.boolean(),
    blockMergeOnChanges: z.boolean(),
    /** null: inherit the workspace's setting. */
    flakyBlocksMerge: z.boolean().nullable(),
    retentionDays: z.number(),
    /** null: no review target. */
    reviewTargetHours: z.number().nullable(),
    staticHostingEnabled: z.boolean(),
  })
  .partial()
  .strict()

const appearanceBody = z
  .object({
    color: z.string().max(40),
    /** null clears the icon (the tile shows the team's first letter). */
    icon: z.string().max(40).nullable(),
  })
  .partial()
  .strict()

const githubBody = z.object({
  installationId: z.string().regex(INSTALLATION_ID_RE, 'The installation id is a number'),
  repoRef: z.string().regex(/^[\w.-]+\/[\w.-]+$/, 'Use owner/name, e.g. acme/web'),
})

const webhookBody = z.object({
  url: z.string().max(2048),
  events: z.array(z.string()).optional(),
})

const NO_EVENTS = 'Choose at least one event for the webhook to receive'

/** A webhook as the dashboard sees it: the signing secret is only shown when it's created. */
async function githubLink(db: Database, teamId: string): Promise<Team.GithubLink | null> {
  const link = await getTeamLink(db, teamId, gitKinds())
  if (!link) return null
  const attention = await getTeamGitAttention(db, teamId, gitKinds())
  return {
    ...link,
    attention: attention
      ? { reason: attention.reason, since: attention.since.toISOString() }
      : null,
  }
}

async function tokenInfo(db: Database, teamId: string, canManage: boolean): Promise<Team.Token> {
  const info = await getTeamTokenInfo(db, teamId)
  return {
    canManage,
    hint: info.hint,
    createdAt: info.createdAt?.toISOString() ?? null,
    createdBy: info.createdBy,
    lastUsedAt: info.lastUsedAt?.toISOString() ?? null,
  }
}

function present(hook: Webhook) {
  return {
    id: hook.id,
    url: hook.url,
    events: hook.events,
    enabled: hook.enabled,
    createdAt: hook.createdAt,
  }
}

/**
 * A team's settings and webhooks. Every member can look; owners and admins can change
 * things, and anyone outside the workspace gets "not found" like everywhere else.
 */
export const dashboardSettingsRoutes: FastifyPluginAsync<Deps.Dashboard> = async (app, deps) => {
  const allowPrivate = deps.webhookAllowPrivate === true

  async function load(req: FastifyRequest, reply: FastifyReply) {
    const p = parse(teamParams, req.params)
    const user = currentUser(req)
    const visible = await findTeamForMember(deps.db, {
      workspaceSlug: p.workspace,
      teamSlug: p.team,
      userId: user.id,
      method: user.method,
    })
    const team = visible ? await getTeamById(deps.db, visible.id) : undefined
    if (!visible || !team) {
      await reply.code(404).send({ error: 'Team not found' })
      return undefined
    }
    const role = await getTeamMemberRole(deps.db, team.id, user.id)
    return { team, canManage: role === 'owner' || role === 'admin' }
  }

  async function loadForManager(req: FastifyRequest, reply: FastifyReply) {
    const found = await load(req, reply)
    if (found && !found.canManage) {
      await reply.code(403).send({ error: 'Only owners and admins can change team settings' })
      return undefined
    }
    return found?.team
  }

  app.get('/teams/:workspace/:team/settings', async (req, reply) => {
    const found = await load(req, reply)
    if (!found) return reply
    return {
      canManage: found.canManage,
      settings: teamSettings(found.team),
      appearance: { color: found.team.color, icon: found.team.icon },
      // What a team that inherits gets, so the form can say so.
      workspace: await getWorkspaceSettings(deps.db, found.team.workspaceId),
      webhooks: (await listWebhooks(deps.db, found.team.id)).map(present),
      webhookEvents: WEBHOOK_EVENTS,
      sitesConfigured: deps.sites !== undefined,
      github: {
        configured: githubConfigured(deps),
        webhookUrl: `${deps.publicOrigin}/webhooks/github`,
        link: await githubLink(deps.db, found.team.id),
      },
    }
  })

  app.patch('/teams/:workspace/:team/settings', async (req, reply) => {
    const team = await loadForManager(req, reply)
    if (!team) return reply
    const patch = parse(settingsBody, req.body)
    return { settings: await updateTeamSettings(deps.db, team.id, patch) }
  })

  /** Deletes the team and everything that belongs to it (owners and admins). */
  app.delete('/teams/:workspace/:team', async (req, reply) => {
    const team = await loadForManager(req, reply)
    if (!team) return reply
    await deleteTeamWithToken(deps.db, team.id)
    return reply.code(204).send()
  })

  /** The tile colour and icon (owners and admins). */
  app.patch('/teams/:workspace/:team/appearance', async (req, reply) => {
    const team = await loadForManager(req, reply)
    if (!team) return reply
    const patch = parse(appearanceBody, req.body)
    return { appearance: await updateTeamAppearance(deps.db, team.id, patch) }
  })

  /** Facts about the team's current CI token (members may look); never the token itself. */
  app.get('/teams/:workspace/:team/token', async (req, reply): Promise<Team.Token | void> => {
    const found = await load(req, reply)
    if (!found) return reply
    return tokenInfo(deps.db, found.team.id, found.canManage)
  })

  /** A new CI token. The old one stops working at once; the new one is shown only here. */
  app.post(
    '/teams/:workspace/:team/token',
    async (req, reply): Promise<Team.TokenRotated | void> => {
      const team = await loadForManager(req, reply)
      if (!team) return reply
      const p = parse(teamParams, req.params)
      const issued = await rotateTeamToken(deps.auth, deps.db, {
        workspaceSlug: p.workspace,
        teamSlug: team.slug,
        rotatedBy: currentUser(req).id,
      })
      return { token: issued.token, info: await tokenInfo(deps.db, team.id, true) }
    },
  )

  app.put('/teams/:workspace/:team/github', async (req, reply) => {
    const team = await loadForManager(req, reply)
    if (!team) return reply
    if (!githubConfigured(deps))
      throw new ValidationError('This instance has no GitHub App configured')
    const link = parse(githubBody, req.body)
    await linkTeamToGithub(deps.db, team.id, link)
    return { link: { ...link, attention: null } }
  })

  app.delete('/teams/:workspace/:team/github', async (req, reply) => {
    const team = await loadForManager(req, reply)
    if (!team) return reply
    await unlinkTeamFromGit(deps.db, team.id)
    return reply.code(204).send()
  })

  app.post('/teams/:workspace/:team/webhooks', async (req, reply) => {
    const team = await loadForManager(req, reply)
    if (!team) return reply
    const body = parse(webhookBody, req.body)
    const url = body.url.trim()
    const problem = webhookUrlProblem(url, { allowPrivate })
    if (problem) throw new ValidationError(problem)
    const events = body.events ?? []
    if (events.length === 0) throw new ValidationError(NO_EVENTS)
    const unknown = events.filter((e) => !isWebhookEvent(e))
    if (unknown.length > 0) throw new ValidationError(`Unknown event(s): ${unknown.join(', ')}`)
    const created = await createWebhook(deps.db, {
      teamId: team.id,
      url: new URL(url).toString(),
      events: events.filter(isWebhookEvent),
    })
    return reply.code(201).send({ webhook: present(created), secret: created.secret })
  })

  app.delete('/teams/:workspace/:team/webhooks/:id', async (req, reply) => {
    const team = await loadForManager(req, reply)
    if (!team) return reply
    const { id } = parse(hookParams, req.params)
    // A malformed id can't match a row; keep the database from rejecting it as a bad uuid.
    if (!z.uuid().safeParse(id).success) return reply.code(404).send({ error: 'Webhook not found' })
    await deleteWebhook(deps.db, team.id, id)
    return reply.code(204).send()
  })
}
