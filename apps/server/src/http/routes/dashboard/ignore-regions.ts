import type { IgnoreRegion } from '@circi/api'
import { listIgnoreRegions, schema } from '@circi/db'
import { createIgnoreRegion, deleteIgnoreRegion } from '@circi/services'
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
  resolves: z
    .object({ kind: z.enum(schema.TRIAGE_KINDS), key: z.string().min(1).max(500) })
    .optional(),
})
const idParams = z.object({ id: z.string() })

/**
 * Regions to ignore when comparing a team's screenshots by name (until now only the admin
 * CLI could set them). Any member may add or remove one, as they may from triage; everyone
 * outside the workspace gets "not found". A region is checked for a whole-number rectangle by
 * the repository (400 otherwise).
 */
export const dashboardIgnoreRegionRoutes: FastifyPluginAsync<Deps.Dashboard> = async (
  app,
  deps,
) => {
  app.get('/teams/:workspace/:team/ignore-regions', async (req, reply) => {
    const found = await loadTeam(deps, req, reply)
    if (!found) return reply
    const regions: IgnoreRegion.Item[] = await listIgnoreRegions(deps.db, found.team.id)
    return { regions }
  })

  app.post('/teams/:workspace/:team/ignore-regions', async (req, reply) => {
    const found = await loadTeam(deps, req, reply)
    if (!found) return reply
    const body = parse(regionBody, req.body)
    const region: IgnoreRegion.Item = await createIgnoreRegion(deps.db, {
      teamId: found.team.id,
      ...body,
    })
    return reply.code(201).send(region)
  })

  app.delete('/teams/:workspace/:team/ignore-regions/:id', async (req, reply) => {
    const found = await loadTeam(deps, req, reply)
    if (!found) return reply
    const { id } = parse(idParams, req.params)
    if (!z.uuid().safeParse(id).success) {
      return reply.code(404).send({ error: 'Ignore region not found' })
    }
    await deleteIgnoreRegion(deps.db, found.team.id, id)
    return reply.code(204).send()
  })
}
