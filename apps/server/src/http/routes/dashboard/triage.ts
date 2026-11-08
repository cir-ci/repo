import type { Triage } from '@circi/api'
import { listTriage, schema } from '@circi/db'
import { assignTriage, dismissTriage, snoozeTriage } from '@circi/services'
import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'

import type { Deps } from '#http/lib/deps.ts'
import { loadTeam } from '#http/lib/team-access.ts'
import { parse } from '#http/lib/validation.ts'

const ref = { kind: z.enum(schema.TRIAGE_KINDS), key: z.string().min(1).max(500) }
const assignBody = z.object({ ...ref, assigneeId: z.string().min(1).nullable() })
const snoozeBody = z.object({
  ...ref,
  choice: z.enum(['next_push', 'tomorrow', 'next_week', 'date']),
  date: z.iso.datetime({ offset: true }).optional(),
})
const dismissBody = z.object(ref)

function state(item: {
  kind: Triage.Item['kind']
  key: string
  assigneeId: string | null
  snoozeKind: Triage.Item['snoozeKind']
  snoozedUntil: Date | null
  dismissedAt: Date | null
}): Triage.ItemState {
  return {
    kind: item.kind,
    key: item.key,
    assigneeId: item.assigneeId,
    snoozeKind: item.snoozeKind,
    snoozedUntil: item.snoozedUntil?.toISOString() ?? null,
    dismissed: item.dismissedAt !== null,
  }
}

/**
 * A team's triage queue and what members do with it: assign, snooze, dismiss. Any member of
 * the workspace may; everyone else gets "not found".
 */
export const dashboardTriageRoutes: FastifyPluginAsync<Deps.Dashboard> = async (app, deps) => {
  app.get('/teams/:workspace/:team/triage', async (req, reply) => {
    const found = await loadTeam(deps, req, reply)
    if (!found) return reply
    const queue = await listTriage(deps.db, { teamId: found.team.id, now: new Date() })
    const payload: Triage.Queue = {
      items: queue.items.map((i) =>
        Object.assign({}, i, {
          build: { ...i.build, createdAt: i.build.createdAt.toISOString() },
          snoozedUntil: i.snoozedUntil?.toISOString() ?? null,
        }),
      ),
      rotation: {
        ...queue.rotation,
        until: queue.rotation.until?.toISOString() ?? null,
      },
    }
    return payload
  })

  app.post('/teams/:workspace/:team/triage/assign', async (req, reply) => {
    const found = await loadTeam(deps, req, reply)
    if (!found) return reply
    const body = parse(assignBody, req.body)
    return state(await assignTriage(deps.db, { teamId: found.team.id, ...body }))
  })

  app.post('/teams/:workspace/:team/triage/snooze', async (req, reply) => {
    const found = await loadTeam(deps, req, reply)
    if (!found) return reply
    const { date, ...body } = parse(snoozeBody, req.body)
    const { item } = await snoozeTriage(deps.db, {
      teamId: found.team.id,
      ...body,
      ...(date ? { date: new Date(date) } : {}),
    })
    return state(item)
  })

  app.post('/teams/:workspace/:team/triage/dismiss', async (req, reply) => {
    const found = await loadTeam(deps, req, reply)
    if (!found) return reply
    const body = parse(dismissBody, req.body)
    return state(await dismissTriage(deps.db, { teamId: found.team.id, ...body }))
  })
}
