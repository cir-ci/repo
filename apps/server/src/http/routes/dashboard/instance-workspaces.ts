import type { InstanceAdmin } from '@circi/api'
import { createWorkspace } from '@circi/auth'
import { listInstanceWorkspaces } from '@circi/db'
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

const wire = (w: listInstanceWorkspaces.Item): InstanceAdmin.Workspace => ({
  ...w,
  createdAt: w.createdAt.toISOString(),
})

/** `/api/instance/workspaces`: every workspace of the instance, and creating one for an existing account. */
export const dashboardInstanceWorkspaceRoutes: FastifyPluginAsync<Deps.Dashboard> = async (
  app,
  deps,
) => {
  app.addHook('onRequest', requireInstanceAdmin(deps.db))

  app.get('/instance/workspaces', async (): Promise<InstanceAdmin.WorkspaceList> => ({
    workspaces: (await listInstanceWorkspaces(deps.db)).map(wire),
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
}
