import type { Sidebar, View } from '@circi/api'
import {
  findProjectForMember,
  getSidebar,
  listSavedViews,
  type SavedViewRow,
} from '@circi/db/queries'
import {
  createView,
  deleteView,
  pinProject,
  reorderViews,
  unpinProject,
  updateView,
} from '@circi/services'
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'

import { savedFilters } from '#http/lib/build-filters.ts'
import type { Deps } from '#http/lib/deps.ts'
import { parse } from '#http/lib/validation.ts'
import { loadWorkspace } from '#http/lib/workspace-access.ts'

const viewParams = z.object({ workspace: z.string(), id: z.uuid() })
const pinParams = z.object({ workspace: z.string(), project: z.string() })
const name = z.string().min(1).max(80)
const createBody = z.strictObject({
  name,
  project: z.string().min(1).optional(),
  filters: savedFilters,
  pinned: z.boolean().optional(),
})
const updateBody = z.strictObject({
  name: name.optional(),
  filters: savedFilters.optional(),
  pinned: z.boolean().optional(),
})
const orderBody = z.strictObject({ ids: z.array(z.uuid()).max(100) })

function wire(v: SavedViewRow): View.Item {
  return { ...v, createdAt: v.createdAt.toISOString() }
}

/**
 * The signed-in user's sidebar for a workspace: saved views, pinned projects and the model
 * the sidebar renders. Views are private to their owner, so another member's view is "not
 * found"; anyone outside the workspace gets "not found" for all of it.
 */
export const dashboardViewRoutes: FastifyPluginAsync<Deps.Dashboard> = async (app, deps) => {
  app.get('/workspaces/:workspace/views', async (req) => {
    const found = await loadWorkspace(deps, req)
    const payload: View.List = {
      views: (
        await listSavedViews(deps.db, { userId: found.user.id, workspaceId: found.workspace.id })
      ).map(wire),
    }
    return payload
  })

  app.post('/workspaces/:workspace/views', async (req, reply) => {
    const found = await loadWorkspace(deps, req)
    const body = parse(createBody, req.body)
    let projectId: string | undefined
    if (body.project) {
      const project = await findProjectForMember(deps.db, {
        workspaceSlug: found.workspace.slug,
        projectSlug: body.project,
        userId: found.user.id,
        method: found.user.method,
      })
      if (!project) return reply.code(404).send({ error: 'Project not found' })
      projectId = project.id
    }
    const view = await createView(deps.db, {
      userId: found.user.id,
      workspaceId: found.workspace.id,
      name: body.name,
      filters: body.filters,
      ...(projectId ? { projectId } : {}),
      ...(body.pinned === undefined ? {} : { pinned: body.pinned }),
    })
    return reply.code(201).send(wire(view))
  })

  app.put('/workspaces/:workspace/views/order', async (req) => {
    const found = await loadWorkspace(deps, req)
    const { ids } = parse(orderBody, req.body)
    const payload: View.List = {
      views: (
        await reorderViews(deps.db, { userId: found.user.id, workspaceId: found.workspace.id, ids })
      ).map(wire),
    }
    return payload
  })

  app.patch('/workspaces/:workspace/views/:id', async (req) => {
    const found = await loadWorkspace(deps, req)
    const { id } = parse(viewParams, req.params)
    const body = parse(updateBody, req.body)
    const view = await updateView(deps.db, {
      userId: found.user.id,
      workspaceId: found.workspace.id,
      id,
      ...(body.name === undefined ? {} : { name: body.name }),
      ...(body.filters === undefined ? {} : { filters: body.filters }),
      ...(body.pinned === undefined ? {} : { pinned: body.pinned }),
    })
    return wire(view)
  })

  app.delete('/workspaces/:workspace/views/:id', async (req, reply) => {
    const found = await loadWorkspace(deps, req)
    const { id } = parse(viewParams, req.params)
    await deleteView(deps.db, { userId: found.user.id, workspaceId: found.workspace.id, id })
    return reply.code(204).send()
  })

  async function pinRoute(req: FastifyRequest, reply: FastifyReply, pinned: boolean) {
    const found = await loadWorkspace(deps, req)
    const p = parse(pinParams, req.params)
    const project = await findProjectForMember(deps.db, {
      workspaceSlug: found.workspace.slug,
      projectSlug: p.project,
      userId: found.user.id,
      method: found.user.method,
    })
    if (!project) return reply.code(404).send({ error: 'Project not found' })
    const input = { userId: found.user.id, projectId: project.id }
    const changed = pinned ? await pinProject(deps.db, input) : await unpinProject(deps.db, input)
    const payload: Sidebar.PinResult = { pinned, changed }
    return payload
  }

  app.put('/workspaces/:workspace/pinned-projects/:project', (req, reply) =>
    pinRoute(req, reply, true),
  )
  app.delete('/workspaces/:workspace/pinned-projects/:project', (req, reply) =>
    pinRoute(req, reply, false),
  )

  app.get('/workspaces/:workspace/sidebar', async (req) => {
    const found = await loadWorkspace(deps, req)
    const sidebar = await getSidebar(deps.db, {
      userId: found.user.id,
      workspace: { id: found.workspace.id, slug: found.workspace.slug },
      now: new Date(),
      method: found.user.method,
    })
    const payload: Sidebar.Model = {
      ...sidebar,
      views: sidebar.views.map(wire),
      canManage: found.canManage,
    }
    return payload
  })
}
