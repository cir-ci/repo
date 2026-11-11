import type { IgnoreRegion } from '@circi/api'
import { TRIAGE_KINDS } from '@circi/core'
import { listIgnoreRegions, listIgnoreRegionSnapshots } from '@circi/db/queries'
import { createIgnoreRegion, deleteIgnoreRegion, editIgnoreRegion } from '@circi/services'
import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'

import type { Deps } from '#http/lib/deps.ts'
import { loadProject } from '#http/lib/project-access.ts'
import { parse } from '#http/lib/validation.ts'

const regionBody = z.object({
  name: z.string().max(500),
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
  /** The triage item this region answers; it is dismissed with the region added. */
  resolves: z.object({ kind: z.enum(TRIAGE_KINDS), key: z.string().min(1).max(500) }).optional(),
})
const editBody = z
  .object({
    name: z.string().max(500),
    x: z.number(),
    y: z.number(),
    width: z.number(),
    height: z.number(),
  })
  .partial()
  .strict()
const FORBIDDEN = 'Only owners and admins can change ignore regions'
const listQuery = z.object({ name: z.string().min(1).max(500).optional() })
const idParams = z.object({ id: z.string() })

const present = (r: Awaited<ReturnType<typeof listIgnoreRegions>>[number]): IgnoreRegion.Item => ({
  ...r,
  createdAt: r.createdAt.toISOString(),
})

/**
 * Regions to ignore when comparing a project's screenshots by name. Any member may read them; only owners
 * and admins add, move or remove one (members get 403); everyone outside the workspace gets "not found". A region is checked for a whole-number rectangle by
 * the repository (400 otherwise).
 */
export const dashboardIgnoreRegionRoutes: FastifyPluginAsync<Deps.Dashboard> = async (
  app,
  deps,
) => {
  app.get('/projects/:workspace/:project/ignore-regions', async (req) => {
    const found = await loadProject(deps, req)
    const { name } = parse(listQuery, req.query)
    const list: IgnoreRegion.List = {
      regions: (await listIgnoreRegions(deps.db, found.project.id)).map(present),
      snapshots: await listIgnoreRegionSnapshots(deps.db, found.project.id, name),
    }
    return list
  })

  app.post('/projects/:workspace/:project/ignore-regions', async (req, reply) => {
    const found = await loadProject(deps, req, { manage: true, forbidden: FORBIDDEN })
    const body = parse(regionBody, req.body)
    const region = await createIgnoreRegion(deps.db, {
      projectId: found.project.id,
      createdBy: found.user.id,
      ...body,
    })
    return reply.code(201).send(present(region))
  })

  app.patch('/projects/:workspace/:project/ignore-regions/:id', async (req, reply) => {
    const found = await loadProject(deps, req, { manage: true, forbidden: FORBIDDEN })
    const { id } = parse(idParams, req.params)
    if (!z.uuid().safeParse(id).success) {
      return reply.code(404).send({ error: 'Ignore region not found' })
    }
    const patch = parse(editBody, req.body)
    return present(await editIgnoreRegion(deps.db, found.project.id, id, patch))
  })

  app.delete('/projects/:workspace/:project/ignore-regions/:id', async (req, reply) => {
    const found = await loadProject(deps, req, { manage: true, forbidden: FORBIDDEN })
    const { id } = parse(idParams, req.params)
    if (!z.uuid().safeParse(id).success) {
      return reply.code(404).send({ error: 'Ignore region not found' })
    }
    await deleteIgnoreRegion(deps.db, found.project.id, id)
    return reply.code(204).send()
  })
}
