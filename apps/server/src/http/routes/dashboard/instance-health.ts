import type { InstanceAdmin } from '@circi/api'
import { getQueueDepth, QUEUES } from '@circi/db'
import type { FastifyPluginAsync } from 'fastify'

import { requireInstanceAdmin } from '#http/hooks/instance-admin.ts'
import type { Deps } from '#http/lib/deps.ts'
import { addressChecklist } from '#http/lib/instance-settings.ts'
import { httpFetcher, runDoctor } from '#lifecycle/doctor.ts'

/** `/api/instance/health/…`: the doctor's checks, the address-change checklist, job queue depth. */
export const dashboardInstanceHealthRoutes: FastifyPluginAsync<Deps.Dashboard> = async (
  app,
  deps,
) => {
  app.addHook('onRequest', requireInstanceAdmin(deps.db))

  /** The same checks as `circi admin doctor` (it asks other hosts, so it can take a few seconds). */
  app.get('/instance/health/checks', async (_req, reply) => {
    if (!deps.instance) return reply.code(501).send({ error: 'Health checks are not available' })
    const found = await runDoctor(
      deps.instance.config,
      deps.instance.fetchHost ?? httpFetcher,
      deps.storage,
    )
    const checks: InstanceAdmin.Checks = {
      findings: found.map((f): InstanceAdmin.Finding => ({
        id: f.id,
        level: f.level,
        message: f.message,
        fix: f.fix ?? null,
      })),
      warned: found.some((f) => f.level === 'warn'),
    }
    return checks
  })

  app.get('/instance/health/address-checklist', async (_req, reply) => {
    if (!deps.instance) return reply.code(501).send({ error: 'The checklist is not available' })
    const checklist: InstanceAdmin.AddressChecklist = addressChecklist(deps.instance, deps)
    return checklist
  })

  app.get('/instance/health/queues', async (): Promise<InstanceAdmin.Queues> => {
    const depth = await getQueueDepth(deps.db, Object.values(QUEUES))
    return {
      queues: depth.map((q): InstanceAdmin.QueueDepth => ({
        queue: q.queue,
        pending: q.pending,
        running: q.running,
        failed: q.failed,
        oldestPendingAt: q.oldestPendingAt?.toISOString() ?? null,
      })),
    }
  })
}
