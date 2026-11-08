import type { Comment } from '@circi/api'
import {
  getBuildByNumber,
  getProjectMemberRole,
  listBuildComments,
  type VisibleProject,
} from '@circi/db'
import { addComment, deleteComment, editComment, MAX_COMMENT_LENGTH } from '@circi/services'
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'

import { currentUser } from '../../hooks/session.ts'
import type { DashboardDeps } from '../../lib/deps.ts'
import { loadProject } from '../../lib/project-access.ts'
import { parse } from '../../lib/validation.ts'

const buildParams = z.object({ org: z.string(), project: z.string(), number: z.string() })
const commentParams = buildParams.extend({ id: z.uuid() })
const fraction = z.number().min(0).max(1)
const createBody = z.object({
  body: z.string().trim().min(1).max(MAX_COMMENT_LENGTH),
  snapshotName: z.string().min(1).max(500).optional(),
  region: z
    .object({ x: fraction, y: fraction, width: fraction, height: fraction })
    .refine((r) => r.width > 0 && r.height > 0 && r.x + r.width <= 1 && r.y + r.height <= 1, {
      message: 'region must lie inside the snapshot',
    })
    .optional(),
  parentId: z.uuid().optional(),
})
const editBody = z.object({ body: z.string().trim().min(1).max(MAX_COMMENT_LENGTH) })

/**
 * Comments on a build. Any member of the project's organization may read and write them;
 * everyone else gets "not found". You edit only your own; you delete your own, and owners and
 * admins may delete anyone's.
 */
export const dashboardCommentRoutes: FastifyPluginAsync<DashboardDeps> = async (app, deps) => {
  async function loadBuild(req: FastifyRequest, reply: FastifyReply) {
    const access = await loadProject(deps, req, reply)
    if (!access) return undefined
    const { project } = access
    const number = Number(parse(buildParams, req.params).number)
    const build = Number.isInteger(number)
      ? await getBuildByNumber(deps.db, project.id, number)
      : undefined
    if (!build) {
      await reply.code(404).send({ error: 'Build not found' })
      return undefined
    }
    return { project, build }
  }

  const isAdmin = async (project: VisibleProject, userId: string) => {
    const role = await getProjectMemberRole(deps.db, project.id, userId)
    return role === 'owner' || role === 'admin'
  }

  app.get('/projects/:org/:project/builds/:number/comments', async (req, reply) => {
    const found = await loadBuild(req, reply)
    if (!found) return reply
    const user = currentUser(req)
    const admin = await isAdmin(found.project, user.id)
    const items = await listBuildComments(deps.db, found.build.id)
    const payload: Comment.List = {
      comments: items.map((c) => {
        const mine = c.author?.id === user.id
        return Object.assign({}, c, {
          createdAt: c.createdAt.toISOString(),
          editedAt: c.editedAt?.toISOString() ?? null,
          deletedAt: c.deletedAt?.toISOString() ?? null,
          mine,
          canDelete: !c.deletedAt && (mine || admin),
        })
      }),
    }
    return payload
  })

  app.post('/projects/:org/:project/builds/:number/comments', async (req, reply) => {
    const found = await loadBuild(req, reply)
    if (!found) return reply
    const input = parse(createBody, req.body)
    const user = currentUser(req)
    const created = await addComment(deps.db, {
      buildId: found.build.id,
      authorId: user.id,
      body: input.body,
      ...(input.snapshotName ? { snapshotName: input.snapshotName } : {}),
      ...(input.region ? { region: input.region } : {}),
      ...(input.parentId ? { parentId: input.parentId } : {}),
    })
    return reply.code(201).send({ id: created.id })
  })

  app.patch('/projects/:org/:project/builds/:number/comments/:id', async (req, reply) => {
    const found = await loadBuild(req, reply)
    if (!found) return reply
    const { id } = parse(commentParams, req.params)
    const { body } = parse(editBody, req.body)
    const updated = await editComment(deps.db, {
      buildId: found.build.id,
      commentId: id,
      userId: currentUser(req).id,
      body,
    })
    return { id: updated.id, body: updated.body, editedAt: updated.editedAt?.toISOString() ?? null }
  })

  app.delete('/projects/:org/:project/builds/:number/comments/:id', async (req, reply) => {
    const found = await loadBuild(req, reply)
    if (!found) return reply
    const { id } = parse(commentParams, req.params)
    const user = currentUser(req)
    await deleteComment(deps.db, {
      buildId: found.build.id,
      commentId: id,
      userId: user.id,
      asAdmin: await isAdmin(found.project, user.id),
    })
    return reply.code(204).send()
  })
}
