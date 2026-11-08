import type { IgnoreRegion } from '@circi/api'
import { listIgnoreRegions, schema } from '@circi/db'
import { createIgnoreRegion, deleteIgnoreRegion } from '@circi/services'
import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'

import type { DashboardDeps } from '../../lib/deps.ts'
import { loadProject } from '../../lib/project-access.ts'
import { parse } from '../../lib/validation.ts'

const regionBody = z.object({
  name: z.string().max(500),
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
  /** The triage item this region answers; it is dismissed with the region added. */
  resolves: z
    .object({ kind: z.enum(schema.TRIAGE_KINDS), key: z.string().min(1).max(500) })
    .optional(),
})
const idParams = z.object({ id: z.string() })

/**
 * Regions to ignore when comparing a project's screenshots by name (until now only the admin
 * CLI could set them). Any member may add or remove one, as they may from triage; everyone
 * outside the organization gets "not found". A region is checked for a whole-number rectangle by
 * the repository (400 otherwise).
 */
export const dashboardIgnoreRegionRoutes: FastifyPluginAsync<DashboardDeps> = async (app, deps) => {
  app.get('/projects/:org/:project/ignore-regions', async (req, reply) => {
    const found = await loadProject(deps, req, reply)
    if (!found) return reply
    const regions: IgnoreRegion.Item[] = await listIgnoreRegions(deps.db, found.project.id)
    return { regions }
  })

  app.post('/projects/:org/:project/ignore-regions', async (req, reply) => {
    const found = await loadProject(deps, req, reply)
    if (!found) return reply
    const body = parse(regionBody, req.body)
    const region: IgnoreRegion.Item = await createIgnoreRegion(deps.db, {
      projectId: found.project.id,
      ...body,
    })
    return reply.code(201).send(region)
  })

  app.delete('/projects/:org/:project/ignore-regions/:id', async (req, reply) => {
    const found = await loadProject(deps, req, reply)
    if (!found) return reply
    const { id } = parse(idParams, req.params)
    if (!z.uuid().safeParse(id).success) {
      return reply.code(404).send({ error: 'Ignore region not found' })
    }
    await deleteIgnoreRegion(deps.db, found.project.id, id)
    return reply.code(204).send()
  })
}
