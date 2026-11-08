import type { InstanceAdmin } from '@circi/api'
import { createWorkspace } from '@circi/auth'
import { workspaceDaysLeft } from '@circi/core'
import { ConflictError, listInstanceWorkspaces, NotFoundError } from '@circi/db'
import { purgeWorkspace, restoreWorkspace } from '@circi/services'
import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'

import { requireInstanceAdmin } from '#http/hooks/instance-admin.ts'
import type { Deps } from '#http/lib/deps.ts'
import { parse } from '#http/lib/validation.ts'

const createBody = z.object({
  name: z.string().trim().min(1).max(100),
  slug: z.string().trim().min(1).max(60).optional(),
  ownerEmail: z.email().max(254),
})

const idParams = z.object({ id: z.string().min(1) })

const wire = (w: listInstanceWorkspaces.Item, now = new Date()): InstanceAdmin.Workspace => ({
  ...w,
  createdAt: w.createdAt.toISOString(),
  deletedAt: w.deletedAt?.toISOString() ?? null,
  daysLeft: w.deletedAt ? workspaceDaysLeft(w.deletedAt, now) : null,
})

/**
 * `/api/instance/workspaces`: every workspace of the instance (deleted ones too, with the days
 * left before they are purged), creating one for an existing account, restoring a deleted one
 * and purging one at once.
 */
export const dashboardInstanceWorkspaceRoutes: FastifyPluginAsync<Deps.Dashboard> = async (
  app,
  deps,
) => {
  app.addHook('onRequest', requireInstanceAdmin(deps.db))

  app.get('/instance/workspaces', async (): Promise<InstanceAdmin.WorkspaceList> => ({
    workspaces: (await listInstanceWorkspaces(deps.db)).map((w) => wire(w)),
  }))

  /** The same operation as `circi admin workspace create`. */
  app.post('/instance/workspaces', async (req, reply) => {
    const body = parse(createBody, req.body)
    const created = await createWorkspace(deps.auth, deps.db, {
      name: body.name,
      ownerEmail: body.ownerEmail,
      ...(body.slug ? { slug: body.slug } : {}),
    })
    const found = (await listInstanceWorkspaces(deps.db)).find((w) => w.id === created.id)
    if (!found) throw new Error('the new workspace is missing from the list')
    return reply.code(201).send({ workspace: wire(found) })
  })

  async function loadDeleted(id: string) {
    const found = (await listInstanceWorkspaces(deps.db)).find((w) => w.id === id)
    if (!found) throw new NotFoundError('No such workspace')
    return found
  }

  /** Brings a deleted workspace back, with everything in it. */
  app.post('/instance/workspaces/:id/restore', async (req) => {
    const { id } = parse(idParams, req.params)
    const found = await loadDeleted(id)
    if (!found.deletedAt) throw new ConflictError('This workspace is not deleted')
    await restoreWorkspace(deps.db, id)
    return { workspace: wire(await loadDeleted(id)) }
  })

  /** "Delete permanently now": skips the rest of the 30 days. Only for a workspace already deleted. */
  app.post('/instance/workspaces/:id/purge', async (req, reply) => {
    const { id } = parse(idParams, req.params)
    const found = await loadDeleted(id)
    if (!found.deletedAt) {
      throw new ConflictError('Only a deleted workspace can be purged: an owner deletes it first')
    }
    await purgeWorkspace(deps.db, { workspaceId: id })
    return reply.code(204).send()
  })
}
