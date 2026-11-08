import { rotateProjectToken } from '@circi/auth'
import { ValidationError, webhookUrlProblem } from '@circi/core'
import {
  createWebhook,
  deleteWebhook,
  findProjectForMember,
  getProjectById,
  getProjectLink,
  linkProjectToGithub,
  unlinkProject,
  getProjectMemberRole,
  isWebhookEvent,
  listWebhooks,
  projectSettings,
  updateProjectSettings,
  WEBHOOK_EVENTS,
  type Webhook,
} from '@circi/db'
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'

import { currentUser } from '../../hooks/session.ts'
import type { DashboardDeps } from '../../lib/deps.ts'
import { parse } from '../../lib/validation.ts'

const projectParams = z.object({ org: z.string(), project: z.string() })
const hookParams = projectParams.extend({ id: z.string() })

const settingsBody = z
  .object({
    name: z.string().max(100),
    defaultBranch: z.string().max(255),
    diffThreshold: z.number(),
    autoApproveDefaultBranch: z.boolean(),
    blockMergeOnChanges: z.boolean(),
    retentionDays: z.number(),
    staticHostingEnabled: z.boolean(),
  })
  .partial()
  .strict()

const githubBody = z.object({
  installationId: z.string().regex(/^\d{1,20}$/, 'The installation id is a number'),
  repoRef: z.string().regex(/^[\w.-]+\/[\w.-]+$/, 'Use owner/name, e.g. acme/web'),
})

const webhookBody = z.object({
  url: z.string().max(2048),
  events: z.array(z.string()).optional(),
})

/** A webhook as the dashboard sees it: the signing secret is only shown when it's created. */
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
 * A project's settings and webhooks. Every member can look; owners and admins can change
 * things, and anyone outside the organization gets "not found" like everywhere else.
 */
export const dashboardSettingsRoutes: FastifyPluginAsync<DashboardDeps> = async (app, deps) => {
  const allowPrivate = deps.webhookAllowPrivate === true

  async function load(req: FastifyRequest, reply: FastifyReply) {
    const p = parse(projectParams, req.params)
    const user = currentUser(req)
    const visible = await findProjectForMember(deps.db, {
      orgSlug: p.org,
      projectSlug: p.project,
      userId: user.id,
      method: user.method,
    })
    const project = visible ? await getProjectById(deps.db, visible.id) : undefined
    if (!visible || !project) {
      await reply.code(404).send({ error: 'Project not found' })
      return undefined
    }
    const role = await getProjectMemberRole(deps.db, project.id, user.id)
    return { project, canManage: role === 'owner' || role === 'admin' }
  }

  async function loadForManager(req: FastifyRequest, reply: FastifyReply) {
    const found = await load(req, reply)
    if (found && !found.canManage) {
      await reply.code(403).send({ error: 'Only owners and admins can change project settings' })
      return undefined
    }
    return found?.project
  }

  app.get('/projects/:org/:project/settings', async (req, reply) => {
    const found = await load(req, reply)
    if (!found) return reply
    return {
      canManage: found.canManage,
      settings: projectSettings(found.project),
      webhooks: (await listWebhooks(deps.db, found.project.id)).map(present),
      webhookEvents: WEBHOOK_EVENTS,
      sitesConfigured: deps.sites !== undefined,
      github: {
        configured: deps.githubApp === true,
        webhookUrl: `${deps.publicOrigin}/webhooks/github`,
        link: (await getProjectLink(deps.db, found.project.id)) ?? null,
      },
    }
  })

  app.patch('/projects/:org/:project/settings', async (req, reply) => {
    const project = await loadForManager(req, reply)
    if (!project) return reply
    const patch = parse(settingsBody, req.body)
    return { settings: await updateProjectSettings(deps.db, project.id, patch) }
  })

  /** A new CI token. The old one stops working at once; the new one is shown only here. */
  app.post('/projects/:org/:project/token', async (req, reply) => {
    const project = await loadForManager(req, reply)
    if (!project) return reply
    const p = parse(projectParams, req.params)
    const issued = await rotateProjectToken(deps.auth, deps.db, {
      orgSlug: p.org,
      projectSlug: project.slug,
    })
    return { token: issued.token }
  })

  app.put('/projects/:org/:project/github', async (req, reply) => {
    const project = await loadForManager(req, reply)
    if (!project) return reply
    if (!deps.githubApp) throw new ValidationError('This instance has no GitHub App configured')
    const link = parse(githubBody, req.body)
    await linkProjectToGithub(deps.db, project.id, link)
    return { link }
  })

  app.delete('/projects/:org/:project/github', async (req, reply) => {
    const project = await loadForManager(req, reply)
    if (!project) return reply
    await unlinkProject(deps.db, project.id)
    return reply.code(204).send()
  })

  app.post('/projects/:org/:project/webhooks', async (req, reply) => {
    const project = await loadForManager(req, reply)
    if (!project) return reply
    const body = parse(webhookBody, req.body)
    const url = body.url.trim()
    const problem = webhookUrlProblem(url, { allowPrivate })
    if (problem) throw new ValidationError(problem)
    const events = body.events ?? []
    const unknown = events.filter((e) => !isWebhookEvent(e))
    if (unknown.length > 0) throw new ValidationError(`Unknown event(s): ${unknown.join(', ')}`)
    const created = await createWebhook(deps.db, {
      projectId: project.id,
      url: new URL(url).toString(),
      events: events.filter(isWebhookEvent),
    })
    return reply.code(201).send({ webhook: present(created), secret: created.secret })
  })

  app.delete('/projects/:org/:project/webhooks/:id', async (req, reply) => {
    const project = await loadForManager(req, reply)
    if (!project) return reply
    const { id } = parse(hookParams, req.params)
    // A malformed id can't match a row; keep the database from rejecting it as a bad uuid.
    if (!z.uuid().safeParse(id).success) return reply.code(404).send({ error: 'Webhook not found' })
    await deleteWebhook(deps.db, project.id, id)
    return reply.code(204).send()
  })
}
