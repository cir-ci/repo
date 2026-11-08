import type { Figma } from '@circi/api'
import {
  figmaFrameUrl,
  openSecret,
  parseFigmaFileRef,
  parseFigmaUrl,
  sealSecret,
} from '@circi/core'
import {
  createFigmaLink,
  createIntegration,
  deleteFigmaLink,
  findFigmaIntegration,
  getMemberRole,
  getProjectBySlugs,
  isFigmaAccountClaimedElsewhere,
  listFigmaLinks,
  listFigmaProjects,
  rememberFigmaFrames,
} from '@circi/db'
import { FigmaApiError } from '@circi/providers'
import { autoLinkFigmaFrames, clearFigmaFile, setFigmaFile } from '@circi/services'
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'

import type { Deps } from '#http/lib/deps.ts'
import { loadOrg } from '#http/lib/org-access.ts'
import { parse } from '#http/lib/validation.ts'

const orgParams = z.object({ org: z.string() })
const projectParams = orgParams.extend({ project: z.string() })
const linkParams = projectParams.extend({ id: z.string() })
const tokenBody = z.strictObject({ token: z.string().trim().min(8).max(500) })
const fileBody = z.strictObject({ file: z.string().trim().min(1).max(500) })
const linkBody = z.strictObject({
  pattern: z.string().trim().min(1).max(200),
  url: z.string().trim().min(1).max(1000),
})

const NOT_CONNECTED = 'Figma is not connected'

/** Answers for a failed call to Figma. */
async function figmaFailed(err: unknown, req: FastifyRequest, reply: FastifyReply) {
  if (err instanceof FigmaApiError) {
    if (err.revoked) return reply.code(400).send({ error: 'Figma rejected the token' })
    if (err.status === 404) return reply.code(400).send({ error: 'Figma could not find that file' })
    if (err.status === 403) {
      return reply.code(400).send({ error: 'The token has no access to that file' })
    }
  }
  req.log.warn({ err }, 'Figma call failed')
  return reply.code(502).send({ error: 'Figma did not answer; try again shortly' })
}

const wireLink = (l: Awaited<ReturnType<typeof listFigmaLinks>>[number]): Figma.Link => ({
  id: l.id,
  snapshotPattern: l.snapshotPattern,
  fileKey: l.fileKey,
  nodeId: l.nodeId,
  frameName: l.frameName,
  url: figmaFrameUrl(l.fileKey, l.nodeId),
  source: l.source,
  createdAt: l.createdAt.toISOString(),
})

/**
 * Figma, per organisation: the connection (a token, verified with Figma), the Figma file each
 * project is designed in, and the links from snapshot names to frames. Every member can look;
 * owners and admins change things. Anyone outside the organisation gets "not found".
 */
export const dashboardFigmaRoutes: FastifyPluginAsync<Deps.Dashboard> = async (app, deps) => {
  const base = '/orgs/:org/integrations/figma'

  async function load(req: FastifyRequest, reply: FastifyReply) {
    const found = await loadOrg(deps, req, reply)
    if (!found) return undefined
    const role = await getMemberRole(deps.db, {
      userId: found.user.id,
      organizationId: found.org.id,
    })
    return { ...found, canManage: role === 'owner' || role === 'admin' }
  }

  async function loadForManager(req: FastifyRequest, reply: FastifyReply) {
    const found = await load(req, reply)
    if (found && !found.canManage) {
      await reply.code(403).send({ error: 'Only owners and admins can manage Figma' })
      return undefined
    }
    return found
  }

  /** The organisation's Figma connection with its opened token (absent when unreadable). */
  async function openConnection(orgId: string) {
    const integration = await findFigmaIntegration(deps.db, orgId)
    if (!integration) return undefined
    const token =
      deps.authSecret && integration.encryptedCredentials
        ? openSecret(deps.authSecret, integration.encryptedCredentials)
        : undefined
    return { integration, token, figma: deps.figma }
  }

  /** The connection ready to call Figma with; replies when there is none or it cannot be used. */
  async function connection(orgId: string, reply: FastifyReply) {
    const conn = await openConnection(orgId)
    if (!conn) {
      await reply.code(404).send({ error: NOT_CONNECTED })
      return undefined
    }
    if (!conn.figma || !conn.token) {
      await reply
        .code(400)
        .send({ error: 'The Figma token can no longer be read: connect Figma again' })
      return undefined
    }
    return { integration: conn.integration, token: conn.token, figma: conn.figma }
  }

  async function pageFor(orgId: string, canManage: boolean): Promise<Figma.Page> {
    const integration = await findFigmaIntegration(deps.db, orgId)
    return {
      canManage,
      configured: deps.figma !== undefined && deps.authSecret !== undefined,
      account: integration
        ? {
            id: integration.id,
            name: integration.displayName,
            needsAttention: integration.needsAttention,
            attentionReason: integration.needsAttentionReason,
            createdAt: integration.createdAt.toISOString(),
          }
        : null,
      projects: integration
        ? (await listFigmaProjects(deps.db, orgId, integration.id)).map((p) => ({
            slug: p.slug,
            name: p.name,
            fileKey: p.fileKey,
            fileName: p.fileName,
            fileUrl: p.fileKey ? figmaFrameUrl(p.fileKey) : null,
            frameCount: p.frameCount,
            linked: p.linked,
          }))
        : [],
    }
  }

  app.get(base, async (req, reply) => {
    const found = await load(req, reply)
    if (!found) return reply
    return pageFor(found.org.id, found.canManage)
  })

  /**
   * Connects the organisation's Figma account with a personal access token or an OAuth token.
   * Figma has to accept it (`/v1/me`), and no other organisation may use the same account.
   */
  app.post(base, async (req, reply) => {
    const found = await loadForManager(req, reply)
    if (!found) return reply
    if (!deps.figma || !deps.authSecret) {
      return reply.code(400).send({ error: 'This instance cannot reach Figma' })
    }
    const { token } = parse(tokenBody, req.body)
    if (await findFigmaIntegration(deps.db, found.org.id)) {
      return reply.code(409).send({ error: 'Figma is already connected: remove it first' })
    }
    let me
    try {
      me = await deps.figma.me(token)
    } catch (err) {
      return figmaFailed(err, req, reply)
    }
    if (await isFigmaAccountClaimedElsewhere(deps.db, me.id, found.org.id)) {
      return reply
        .code(409)
        .send({ error: 'That Figma account is already connected to another organization' })
    }
    const row = await createIntegration(deps.db, {
      orgId: found.org.id,
      kind: 'figma',
      displayName: me.handle,
      externalId: me.id,
      encryptedCredentials: sealSecret(deps.authSecret, token),
      createdBy: found.user.id,
    })
    return reply.code(201).send({ id: row.id })
  })

  /** Chooses the Figma file a project is designed in (an address or the file key). */
  app.put(`${base}/projects/:project`, async (req, reply) => {
    const found = await loadForManager(req, reply)
    if (!found) return reply
    const conn = await connection(found.org.id, reply)
    if (!conn) return reply
    const { project: slug } = parse(projectParams, req.params)
    const project = await getProjectBySlugs(deps.db, {
      orgSlug: found.org.slug,
      projectSlug: slug,
    })
    const { file } = parse(fileBody, req.body)
    const fileKey = parseFigmaFileRef(file)
    if (!fileKey) return reply.code(400).send({ error: 'That is not a Figma file address' })
    let name
    try {
      name = (await conn.figma.getFile(conn.token, fileKey)).name
    } catch (err) {
      return figmaFailed(err, req, reply)
    }
    await setFigmaFile(deps.db, {
      projectId: project.id,
      orgId: found.org.id,
      integrationId: conn.integration.id,
      fileKey,
      fileName: name,
    })
    const projects = await listFigmaProjects(deps.db, found.org.id, conn.integration.id)
    return projects.find((p) => p.projectId === project.id)
  })

  app.delete(`${base}/projects/:project`, async (req, reply) => {
    const found = await loadForManager(req, reply)
    if (!found) return reply
    const integration = await findFigmaIntegration(deps.db, found.org.id)
    if (!integration) return reply.code(404).send({ error: NOT_CONNECTED })
    const { project: slug } = parse(projectParams, req.params)
    const project = await getProjectBySlugs(deps.db, {
      orgSlug: found.org.slug,
      projectSlug: slug,
    })
    await clearFigmaFile(deps.db, { projectId: project.id, integrationId: integration.id })
    return reply.code(204).send()
  })

  app.get(`${base}/projects/:project/links`, async (req, reply) => {
    const found = await load(req, reply)
    if (!found) return reply
    const { project: slug } = parse(projectParams, req.params)
    const project = await getProjectBySlugs(deps.db, {
      orgSlug: found.org.slug,
      projectSlug: slug,
    })
    const payload: Figma.Links = {
      links: (await listFigmaLinks(deps.db, project.id)).map(wireLink),
    }
    return payload
  })

  /** Links snapshot names matching a glob to the frame a pasted Figma address points at. */
  app.post(`${base}/projects/:project/links`, async (req, reply) => {
    const found = await loadForManager(req, reply)
    if (!found) return reply
    const integration = await findFigmaIntegration(deps.db, found.org.id)
    if (!integration) return reply.code(404).send({ error: NOT_CONNECTED })
    const { project: slug } = parse(projectParams, req.params)
    const project = await getProjectBySlugs(deps.db, {
      orgSlug: found.org.slug,
      projectSlug: slug,
    })
    const body = parse(linkBody, req.body)
    const target = parseFigmaUrl(body.url)
    if (!target?.nodeId) {
      return reply
        .code(400)
        .send({ error: 'Paste the address of a frame (Copy link to selection in Figma)' })
    }
    const link = await createFigmaLink(deps.db, {
      integrationId: integration.id,
      projectId: project.id,
      snapshotPattern: body.pattern,
      fileKey: target.fileKey,
      nodeId: target.nodeId,
      source: 'manual',
      createdBy: found.user.id,
    })
    // The frame's name is a courtesy: a link made while Figma is down still stands.
    const conn = await openConnection(found.org.id)
    if (conn?.figma && conn.token) {
      try {
        const names = await conn.figma.getNodeNames(conn.token, target.fileKey, [target.nodeId])
        await rememberFigmaFrames(deps.db, {
          integrationId: integration.id,
          projectId: project.id,
          frames: names,
        })
      } catch (err) {
        req.log.warn({ err }, 'could not read the frame name')
      }
    }
    const created = (await listFigmaLinks(deps.db, project.id)).find((l) => l.id === link.id)
    return reply.code(201).send(created ? wireLink(created) : undefined)
  })

  app.delete(`${base}/projects/:project/links/:id`, async (req, reply) => {
    const found = await loadForManager(req, reply)
    if (!found) return reply
    const { project: slug, id } = parse(linkParams, req.params)
    const project = await getProjectBySlugs(deps.db, {
      orgSlug: found.org.slug,
      projectSlug: slug,
    })
    if (!z.uuid().safeParse(id).success || !(await deleteFigmaLink(deps.db, project.id, id))) {
      return reply.code(404).send({ error: 'Link not found' })
    }
    return reply.code(204).send()
  })

  /** Links the project's snapshots to frames of its file by name; manual links are left alone. */
  app.post(`${base}/projects/:project/auto-link`, async (req, reply) => {
    const found = await loadForManager(req, reply)
    if (!found) return reply
    const conn = await connection(found.org.id, reply)
    if (!conn || !deps.authSecret) return reply
    const { project: slug } = parse(projectParams, req.params)
    const project = await getProjectBySlugs(deps.db, {
      orgSlug: found.org.slug,
      projectSlug: slug,
    })
    try {
      const result: Figma.AutoLinkResult = await autoLinkFigmaFrames(deps.db, {
        projectId: project.id,
        secret: deps.authSecret,
        figma: conn.figma,
        createdBy: found.user.id,
      })
      return result
    } catch (err) {
      if (err instanceof FigmaApiError) return figmaFailed(err, req, reply)
      throw err
    }
  })
}
