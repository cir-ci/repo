import type { Project } from '@circi/api'
import { deleteProjectWithToken, rotateProjectToken } from '@circi/auth'
import { NotFoundError, ValidationError } from '@circi/core'
import { checkWebhookEvents, WEBHOOK_EVENTS, webhookUrlProblem } from '@circi/core/node'
import { getWorkspaceSettings, getProjectById, projectSettings } from '@circi/db/queries'
import {
  addWebhook,
  changeProjectSettings,
  linkProjectToGithub,
  regenerateWebhookSecret,
  removeWebhook,
  sendTestWebhook,
  unlinkProjectFromGit,
  updateProjectAppearance,
} from '@circi/services'
import type { FastifyPluginAsync, FastifyRequest } from 'fastify'
import { z } from 'zod'

import { githubConfigured } from '#composition/github-app.ts'
import { integrationContext } from '#composition/integration-context.ts'
import { currentUser } from '#http/hooks/session.ts'
import type { Deps } from '#http/lib/deps.ts'
import { loadProject } from '#http/lib/project-access.ts'
import { parse } from '#http/lib/validation.ts'

import { githubLink, present, presentWebhooks, tokenInfo } from './presenters.ts'
import {
  appearanceBody,
  githubBody,
  hookParams,
  settingsBody,
  projectParams,
  webhookBody,
} from './schemas.ts'

/**
 * A project's settings and webhooks. Every member can look; owners and admins can change
 * things, and anyone outside the workspace gets "not found" like everywhere else.
 */
export const dashboardSettingsRoutes: FastifyPluginAsync<Deps.Dashboard> = async (app, deps) => {
  const allowPrivate = deps.webhookAllowPrivate === true

  async function projectRow(projectId: string) {
    const project = await getProjectById(deps.db, projectId)
    if (!project) throw new NotFoundError('Project not found')
    return project
  }

  async function load(req: FastifyRequest) {
    const found = await loadProject(deps, req)
    return { project: await projectRow(found.project.id), canManage: found.canManage }
  }

  async function loadForManager(req: FastifyRequest) {
    const found = await loadProject(deps, req, {
      manage: true,
      forbidden: 'Only owners and admins can change project settings',
    })
    return projectRow(found.project.id)
  }

  app.get('/projects/:workspace/:project/settings', async (req) => {
    const found = await load(req)
    return {
      canManage: found.canManage,
      settings: projectSettings(found.project),
      appearance: { color: found.project.color, icon: found.project.icon },
      // What a project that inherits gets, so the form can say so.
      workspace: await getWorkspaceSettings(deps.db, found.project.workspaceId),
      webhooks: await presentWebhooks(deps.db, found.project.id),
      webhookEvents: WEBHOOK_EVENTS,
      sitesConfigured: deps.sites !== undefined,
      github: {
        configured: githubConfigured(deps),
        webhookUrl: `${deps.publicOrigin}/webhooks/github`,
        link: await githubLink(deps.db, found.project.id),
      },
    }
  })

  app.patch('/projects/:workspace/:project/settings', async (req) => {
    const project = await loadForManager(req)
    const patch = parse(settingsBody, req.body)
    return { settings: await changeProjectSettings(deps.db, project.id, patch) }
  })

  /** Deletes the project and everything that belongs to it (owners and admins). */
  app.delete('/projects/:workspace/:project', async (req, reply) => {
    const project = await loadForManager(req)
    await deleteProjectWithToken(deps.db, project.id)
    return reply.code(204).send()
  })

  /** The tile colour and icon (owners and admins). */
  app.patch('/projects/:workspace/:project/appearance', async (req) => {
    const project = await loadForManager(req)
    const patch = parse(appearanceBody, req.body)
    return { appearance: await updateProjectAppearance(deps.db, project.id, patch) }
  })

  /** Facts about the project's current CI token (members may look); never the token itself. */
  app.get('/projects/:workspace/:project/token', async (req): Promise<Project.Token | void> => {
    const found = await load(req)
    return tokenInfo(deps.db, found.project.id, found.canManage)
  })

  /** A new CI token. The old one stops working at once; the new one is shown only here. */
  app.post(
    '/projects/:workspace/:project/token',
    async (req): Promise<Project.TokenRotated | void> => {
      const project = await loadForManager(req)
      const p = parse(projectParams, req.params)
      const issued = await rotateProjectToken(deps.auth, deps.db, {
        workspaceSlug: p.workspace,
        projectSlug: project.slug,
        rotatedBy: currentUser(req).id,
      })
      return { token: issued.token, info: await tokenInfo(deps.db, project.id, true) }
    },
  )

  app.put('/projects/:workspace/:project/github', async (req, reply) => {
    const project = await loadForManager(req)
    if (!githubConfigured(deps))
      throw new ValidationError('This instance has no GitHub App configured')
    const link = parse(githubBody, req.body)
    const ctx = integrationContext(deps)
    if (!ctx) return reply.code(400).send({ error: "This instance can't store credentials" })
    // Verified with GitHub like the integration's Add flow: nothing is stored when it fails.
    await linkProjectToGithub(deps.db, project.id, link, ctx)
    return { link: { ...link, attention: null } }
  })

  app.delete('/projects/:workspace/:project/github', async (req, reply) => {
    const project = await loadForManager(req)
    await unlinkProjectFromGit(deps.db, project.id)
    return reply.code(204).send()
  })

  app.post('/projects/:workspace/:project/webhooks', async (req, reply) => {
    const project = await loadForManager(req)
    const body = parse(webhookBody, req.body)
    const url = body.url.trim()
    const problem = webhookUrlProblem(url, { allowPrivate })
    if (problem) throw new ValidationError(problem)
    const events = checkWebhookEvents(body.events ?? [])
    const created = await addWebhook(deps.db, {
      projectId: project.id,
      url: new URL(url).toString(),
      events,
    })
    return reply.code(201).send({ webhook: present(created), secret: created.secret })
  })

  /**
   * Queues a signed test event to one webhook (owners and admins). It goes through the delivery
   * job like a build event, so it shows in the webhook's recent deliveries once it has run.
   */
  app.post('/projects/:workspace/:project/webhooks/:id/test', async (req, reply) => {
    const project = await loadForManager(req)
    const { id } = parse(hookParams, req.params)
    if (!z.uuid().safeParse(id).success) return reply.code(404).send({ error: 'Webhook not found' })
    const deliveryId = await sendTestWebhook(deps.db, project.id, id)
    return reply.code(202).send({ deliveryId })
  })

  /** A new signing secret (owners and admins); the old one stops working, the new one is shown only here. */
  app.post('/projects/:workspace/:project/webhooks/:id/secret', async (req) => {
    const project = await loadForManager(req)
    const { id } = parse(hookParams, req.params)
    if (!z.uuid().safeParse(id).success) throw new NotFoundError('Webhook not found')
    const rotated = await regenerateWebhookSecret(deps.db, project.id, id)
    return { webhook: present(rotated), secret: rotated.secret }
  })

  app.delete('/projects/:workspace/:project/webhooks/:id', async (req, reply) => {
    const project = await loadForManager(req)
    const { id } = parse(hookParams, req.params)
    // A malformed id can't match a row; keep the database from rejecting it as a bad uuid.
    if (!z.uuid().safeParse(id).success) return reply.code(404).send({ error: 'Webhook not found' })
    await removeWebhook(deps.db, project.id, id)
    return reply.code(204).send()
  })
}
