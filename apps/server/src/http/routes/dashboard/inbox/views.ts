import type { Sidebar, View } from '@circi/api'
import { findTeamForMember, getSidebar, listSavedViews, type SavedViewRow } from '@circi/db/queries'
import {
  createView,
  deleteView,
  pinTeam,
  reorderViews,
  unpinTeam,
  updateView,
} from '@circi/services'
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'

import { savedFilters } from '#http/lib/build-filters.ts'
import type { Deps } from '#http/lib/deps.ts'
import { parse } from '#http/lib/validation.ts'
import { loadWorkspace } from '#http/lib/workspace-access.ts'

const viewParams = z.object({ workspace: z.string(), id: z.uuid() })
const pinParams = z.object({ workspace: z.string(), team: z.string() })
const name = z.string().min(1).max(80)
const createBody = z.strictObject({
  name,
  team: z.string().min(1).optional(),
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
 * The signed-in user's sidebar for a workspace: saved views, pinned teams and the model
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
    let teamId: string | undefined
    if (body.team) {
      const team = await findTeamForMember(deps.db, {
        workspaceSlug: found.workspace.slug,
        teamSlug: body.team,
        userId: found.user.id,
        method: found.user.method,
      })
      if (!team) return reply.code(404).send({ error: 'Team not found' })
      teamId = team.id
    }
    const view = await createView(deps.db, {
      userId: found.user.id,
      workspaceId: found.workspace.id,
      name: body.name,
      filters: body.filters,
      ...(teamId ? { teamId } : {}),
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
    const team = await findTeamForMember(deps.db, {
      workspaceSlug: found.workspace.slug,
      teamSlug: p.team,
      userId: found.user.id,
      method: found.user.method,
    })
    if (!team) return reply.code(404).send({ error: 'Team not found' })
    const input = { userId: found.user.id, teamId: team.id }
    const changed = pinned ? await pinTeam(deps.db, input) : await unpinTeam(deps.db, input)
    const payload: Sidebar.PinResult = { pinned, changed }
    return payload
  }

  app.put('/workspaces/:workspace/pinned-teams/:team', (req, reply) => pinRoute(req, reply, true))
  app.delete('/workspaces/:workspace/pinned-teams/:team', (req, reply) =>
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
    const payload: Sidebar.Model = { ...sidebar, views: sidebar.views.map(wire) }
    return payload
  })
}
