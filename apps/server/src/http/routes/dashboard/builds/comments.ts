import type { Comment } from '@circi/api'
import { type CommentItem, listBuildComments } from '@circi/db/queries'
import {
  addComment,
  deleteComment,
  editComment,
  MAX_COMMENT_LENGTH,
  setCommentRegion,
} from '@circi/services'
import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'

import { currentUser } from '#http/hooks/session.ts'
import type { Deps } from '#http/lib/deps.ts'
import { buildParams, loadBuild } from '#http/lib/project-access.ts'
import { parse } from '#http/lib/validation.ts'

const commentParams = buildParams.extend({ id: z.uuid() })
const fraction = z.number().min(0).max(1)
const regionBody = z
  .object({ x: fraction, y: fraction, width: fraction, height: fraction })
  .refine((r) => r.width > 0 && r.height > 0 && r.x + r.width <= 1 && r.y + r.height <= 1, {
    message: 'The region must lie inside the screenshot',
  })
const createBody = z.object({
  body: z.string().trim().min(1).max(MAX_COMMENT_LENGTH),
  snapshotName: z.string().min(1).max(500).optional(),
  region: regionBody.optional(),
  regionSide: z.enum(['baseline', 'current']).optional(),
  parentId: z.uuid().optional(),
})
const editBody = z.object({ body: z.string().trim().min(1).max(MAX_COMMENT_LENGTH) })

/** A listed comment as the dashboard gets it: dates as ISO strings, and what the caller may do with it. */
function present(c: CommentItem, userId: string, admin: boolean): Comment.Item {
  const mine = c.author?.id === userId
  return Object.assign({}, c, {
    createdAt: c.createdAt.toISOString(),
    editedAt: c.editedAt?.toISOString() ?? null,
    deletedAt: c.deletedAt?.toISOString() ?? null,
    mine,
    canDelete: !c.deletedAt && (mine || admin),
  })
}

/**
 * Comments on a build. Any member of the project's workspace may read and write them;
 * everyone else gets "not found". You edit only your own, and only you move or resize its region;
 * you delete your own, and owners and admins may delete anyone's.
 */
export const dashboardCommentRoutes: FastifyPluginAsync<Deps.Dashboard> = async (app, deps) => {
  app.get('/projects/:workspace/:project/builds/:number/comments', async (req) => {
    const found = await loadBuild(deps, req)
    const user = currentUser(req)
    const items = await listBuildComments(deps.db, found.build.id)
    const payload: Comment.List = {
      comments: items.map((c) => present(c, user.id, found.canManage)),
    }
    return payload
  })

  app.post('/projects/:workspace/:project/builds/:number/comments', async (req, reply) => {
    const found = await loadBuild(deps, req)
    const input = parse(createBody, req.body)
    const user = currentUser(req)
    const created = await addComment(deps.db, {
      buildId: found.build.id,
      authorId: user.id,
      body: input.body,
      ...(input.snapshotName ? { snapshotName: input.snapshotName } : {}),
      ...(input.region ? { region: input.region } : {}),
      ...(input.regionSide ? { regionSide: input.regionSide } : {}),
      ...(input.parentId ? { parentId: input.parentId } : {}),
    })
    return reply.code(201).send({ id: created.id })
  })

  app.patch('/projects/:workspace/:project/builds/:number/comments/:id', async (req) => {
    const found = await loadBuild(deps, req)
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

  app.patch('/projects/:workspace/:project/builds/:number/comments/:id/region', async (req) => {
    const found = await loadBuild(deps, req)
    const { id } = parse(commentParams, req.params)
    const region: Comment.SetRegion = parse(regionBody, req.body)
    const user = currentUser(req)
    await setCommentRegion(deps.db, {
      buildId: found.build.id,
      commentId: id,
      userId: user.id,
      region,
    })
    const items = await listBuildComments(deps.db, found.build.id)
    const item = items.find((c) => c.id === id)
    const payload: Comment.Item | undefined = item && present(item, user.id, found.canManage)
    return payload
  })

  app.delete('/projects/:workspace/:project/builds/:number/comments/:id', async (req, reply) => {
    const found = await loadBuild(deps, req)
    const { id } = parse(commentParams, req.params)
    const user = currentUser(req)
    await deleteComment(deps.db, {
      buildId: found.build.id,
      commentId: id,
      userId: user.id,
      asAdmin: found.canManage,
    })
    return reply.code(204).send()
  })
}
