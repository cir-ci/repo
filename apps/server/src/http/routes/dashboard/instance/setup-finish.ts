import { finishFirstRunSetup } from '@circi/services'
import type { FastifyPluginAsync } from 'fastify'

import { requireInstanceAdmin } from '#http/hooks/instance-admin.ts'
import type { Deps } from '#http/lib/deps.ts'

/** `POST /api/instance/setup/finish`: ends the first-run steps (done or skipped). Instance admins. */
export const dashboardSetupFinishRoutes: FastifyPluginAsync<Deps.Dashboard> = async (app, deps) => {
  app.addHook('onRequest', requireInstanceAdmin())

  app.post('/instance/setup/finish', async (_req, reply) => {
    await finishFirstRunSetup(deps.db)
    return reply.code(204).send()
  })
}
