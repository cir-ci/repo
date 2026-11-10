import type { InstanceAdmin } from '@circi/api'
import { getMoveChecklistDismissedFor, getQueueDepth } from '@circi/db/queries'
import { dismissMoveChecklist, restoreMoveChecklist } from '@circi/services'
import type { FastifyPluginAsync } from 'fastify'

import { instanceProbes } from '#composition/doctor-probes.ts'
import { httpFetcher, runDoctor } from '#composition/doctor.ts'
import { addressChecklist } from '#composition/instance-settings.ts'
import { requireInstanceAdmin } from '#http/hooks/instance-admin.ts'
import type { Deps } from '#http/lib/deps.ts'

/** `/api/instance/health/…`: the doctor's checks, the address-change checklist, job queue depth. */
export const dashboardInstanceHealthRoutes: FastifyPluginAsync<Deps.Dashboard> = async (
  app,
  deps,
) => {
  app.addHook('onRequest', requireInstanceAdmin(deps.db))

  /** The same checks as `circi admin doctor` (it asks other hosts, so it can take a few seconds). */
  app.get('/instance/health/checks', async (_req, reply) => {
    if (!deps.instance) return reply.code(501).send({ error: "Health checks aren't available" })
    const found = await runDoctor(
      deps.instance.config,
      deps.instance.fetchHost ?? httpFetcher,
      deps.storage,
      instanceProbes({ db: deps.db, config: deps.instance.config, mailer: deps.instance.mailer }),
    )
    const checks: InstanceAdmin.Checks = {
      findings: found.map((f): InstanceAdmin.Finding => ({
        id: f.id,
        level: f.level,
        label: f.label,
        detail: f.detail,
        value: f.value ?? null,
        message: f.message,
        fix: f.fix ?? null,
      })),
      warned: found.some((f) => f.level === 'warn' || f.level === 'fail'),
    }
    return checks
  })

  app.get('/instance/health/address-checklist', async (_req, reply) => {
    if (!deps.instance) return reply.code(501).send({ error: "The checklist isn't available" })
    const checklist = addressChecklist(deps.instance, deps)
    const dismissedFor = await getMoveChecklistDismissedFor(deps.db)
    const result: InstanceAdmin.AddressChecklist = {
      ...checklist,
      dismissed: dismissedFor === checklist.publicUrl,
      previousHosts: deps.instance.config.previousPublicHosts,
    }
    return result
  })

  /** Hides the checklist for the current address; a different `PUBLIC_URL` brings it back. */
  app.put('/instance/health/address-checklist/dismissed', async (_req, reply) => {
    if (!deps.instance) return reply.code(501).send({ error: "The checklist isn't available" })
    await dismissMoveChecklist(deps.db, deps.instance.config.publicUrl.origin)
    return reply.code(204).send()
  })

  /** Shows the checklist again. */
  app.delete('/instance/health/address-checklist/dismissed', async (_req, reply) => {
    await restoreMoveChecklist(deps.db)
    return reply.code(204).send()
  })

  app.get('/instance/health/queues', async (): Promise<InstanceAdmin.Queues> => {
    const depth = await getQueueDepth(deps.db)
    return {
      queues: depth.map((q): InstanceAdmin.QueueDepth => ({
        queue: q.queue,
        pending: q.pending,
        running: q.running,
        failed: q.failed,
        oldestPendingAt: q.oldestPendingAt?.toISOString() ?? null,
        retrying: q.retrying,
        mostRetried: q.mostRetried,
      })),
    }
  })
}
