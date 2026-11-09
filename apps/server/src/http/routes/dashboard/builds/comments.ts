import type { Comment } from '@circi/api'
import { listBuildComments } from '@circi/db'
import { addComment, deleteComment, editComment, MAX_COMMENT_LENGTH } from '@circi/services'
import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'

import { currentUser } from '#http/hooks/session.ts'
import type { Deps } from '#http/lib/deps.ts'
import { buildParams, loadBuild } from '#http/lib/team-access.ts'
import { parse } from '#http/lib/validation.ts'

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
 * Comments on a build. Any member of the team's workspace may read and write them;
 * everyone else gets "not found". You edit only your own; you delete your own, and owners and
 * admins may delete anyone's.
 */
export const dashboardCommentRoutes: FastifyPluginAsync<Deps.Dashboard> = async (app, deps) => {
  app.get('/teams/:workspace/:team/builds/:number/comments', async (req) => {
    const found = await loadBuild(deps, req)
    const user = currentUser(req)
    const admin = found.canManage
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

  app.post('/teams/:workspace/:team/builds/:number/comments', async (req, reply) => {
    const found = await loadBuild(deps, req)
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

  app.patch('/teams/:workspace/:team/builds/:number/comments/:id', async (req) => {
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

  app.delete('/teams/:workspace/:team/builds/:number/comments/:id', async (req, reply) => {
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
