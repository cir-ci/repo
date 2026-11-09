import type { IgnoreRegion } from '@circi/api'
import { TRIAGE_KINDS } from '@circi/core'
import { listIgnoreRegions, listIgnoreRegionSnapshots } from '@circi/db'
import { createIgnoreRegion, deleteIgnoreRegion, editIgnoreRegion } from '@circi/services'
import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'

import type { Deps } from '#http/lib/deps.ts'
import { loadTeam } from '#http/lib/team-access.ts'
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
const idParams = z.object({ id: z.string() })

const present = (r: Awaited<ReturnType<typeof listIgnoreRegions>>[number]): IgnoreRegion.Item => ({
  ...r,
  createdAt: r.createdAt.toISOString(),
})

/**
 * Regions to ignore when comparing a team's screenshots by name. Any member may add, move or
 * remove one, as they may from triage; everyone
 * outside the workspace gets "not found". A region is checked for a whole-number rectangle by
 * the repository (400 otherwise).
 */
export const dashboardIgnoreRegionRoutes: FastifyPluginAsync<Deps.Dashboard> = async (
  app,
  deps,
) => {
  app.get('/teams/:workspace/:team/ignore-regions', async (req) => {
    const found = await loadTeam(deps, req)
    const list: IgnoreRegion.List = {
      regions: (await listIgnoreRegions(deps.db, found.team.id)).map(present),
      snapshots: await listIgnoreRegionSnapshots(deps.db, found.team.id),
    }
    return list
  })

  app.post('/teams/:workspace/:team/ignore-regions', async (req, reply) => {
    const found = await loadTeam(deps, req)
    const body = parse(regionBody, req.body)
    const region = await createIgnoreRegion(deps.db, {
      teamId: found.team.id,
      createdBy: found.user.id,
      ...body,
    })
    return reply.code(201).send(present(region))
  })

  app.patch('/teams/:workspace/:team/ignore-regions/:id', async (req, reply) => {
    const found = await loadTeam(deps, req)
    const { id } = parse(idParams, req.params)
    if (!z.uuid().safeParse(id).success) {
      return reply.code(404).send({ error: 'Ignore region not found' })
    }
    const patch = parse(editBody, req.body)
    return present(await editIgnoreRegion(deps.db, found.team.id, id, patch))
  })

  app.delete('/teams/:workspace/:team/ignore-regions/:id', async (req, reply) => {
    const found = await loadTeam(deps, req)
    const { id } = parse(idParams, req.params)
    if (!z.uuid().safeParse(id).success) {
      return reply.code(404).send({ error: 'Ignore region not found' })
    }
    await deleteIgnoreRegion(deps.db, found.team.id, id)
    return reply.code(204).send()
  })
}
