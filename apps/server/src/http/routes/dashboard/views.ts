import type { Sidebar, View } from '@circi/api'
import { findProjectForMember, getSidebar, listSavedViews, type SavedViewRow } from '@circi/db'
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
import type { DashboardDeps } from '#http/lib/deps.ts'
import { loadOrg } from '#http/lib/org-access.ts'
import { parse } from '#http/lib/validation.ts'

const viewParams = z.object({ org: z.string(), id: z.uuid() })
const pinParams = z.object({ org: z.string(), project: z.string() })
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
 * The signed-in user's sidebar for an organization: saved views, pinned projects and the model
 * the sidebar renders. Views are private to their owner, so another member's view is "not
 * found"; anyone outside the organization gets "not found" for all of it.
 */
export const dashboardViewRoutes: FastifyPluginAsync<DashboardDeps> = async (app, deps) => {
  app.get('/orgs/:org/views', async (req, reply) => {
    const found = await loadOrg(deps, req, reply)
    if (!found) return reply
    const payload: View.List = {
      views: (await listSavedViews(deps.db, { userId: found.user.id, orgId: found.org.id })).map(
        wire,
      ),
    }
    return payload
  })

  app.post('/orgs/:org/views', async (req, reply) => {
    const found = await loadOrg(deps, req, reply)
    if (!found) return reply
    const body = parse(createBody, req.body)
    let projectId: string | undefined
    if (body.project) {
      const project = await findProjectForMember(deps.db, {
        orgSlug: found.org.slug,
        projectSlug: body.project,
        userId: found.user.id,
        method: found.user.method,
      })
      if (!project) return reply.code(404).send({ error: 'Project not found' })
      projectId = project.id
    }
    const view = await createView(deps.db, {
      userId: found.user.id,
      orgId: found.org.id,
      name: body.name,
      filters: body.filters,
      ...(projectId ? { projectId } : {}),
      ...(body.pinned === undefined ? {} : { pinned: body.pinned }),
    })
    return reply.code(201).send(wire(view))
  })

  app.put('/orgs/:org/views/order', async (req, reply) => {
    const found = await loadOrg(deps, req, reply)
    if (!found) return reply
    const { ids } = parse(orderBody, req.body)
    const payload: View.List = {
      views: (await reorderViews(deps.db, { userId: found.user.id, orgId: found.org.id, ids })).map(
        wire,
      ),
    }
    return payload
  })

  app.patch('/orgs/:org/views/:id', async (req, reply) => {
    const found = await loadOrg(deps, req, reply)
    if (!found) return reply
    const { id } = parse(viewParams, req.params)
    const body = parse(updateBody, req.body)
    const view = await updateView(deps.db, {
      userId: found.user.id,
      orgId: found.org.id,
      id,
      ...(body.name === undefined ? {} : { name: body.name }),
      ...(body.filters === undefined ? {} : { filters: body.filters }),
      ...(body.pinned === undefined ? {} : { pinned: body.pinned }),
    })
    return wire(view)
  })

  app.delete('/orgs/:org/views/:id', async (req, reply) => {
    const found = await loadOrg(deps, req, reply)
    if (!found) return reply
    const { id } = parse(viewParams, req.params)
    await deleteView(deps.db, { userId: found.user.id, orgId: found.org.id, id })
    return reply.code(204).send()
  })

  async function pinRoute(req: FastifyRequest, reply: FastifyReply, pinned: boolean) {
    const found = await loadOrg(deps, req, reply)
    if (!found) return reply
    const p = parse(pinParams, req.params)
    const project = await findProjectForMember(deps.db, {
      orgSlug: found.org.slug,
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

  app.put('/orgs/:org/pinned-projects/:project', (req, reply) => pinRoute(req, reply, true))
  app.delete('/orgs/:org/pinned-projects/:project', (req, reply) => pinRoute(req, reply, false))

  app.get('/orgs/:org/sidebar', async (req, reply) => {
    const found = await loadOrg(deps, req, reply)
    if (!found) return reply
    const sidebar = await getSidebar(deps.db, {
      userId: found.user.id,
      org: { id: found.org.id, slug: found.org.slug },
      now: new Date(),
      method: found.user.method,
    })
    const payload: Sidebar.Model = { ...sidebar, views: sidebar.views.map(wire) }
    return payload
  })
}
