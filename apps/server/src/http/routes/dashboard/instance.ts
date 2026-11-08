import {
  dismissPublicUrlChange,
  getPublicUrlChange,
  isInstanceAdmin,
  publicUrlChecklist,
} from '@circi/db'
import type { FastifyPluginAsync } from 'fastify'

import { currentUser } from '#http/hooks/session.ts'
import type { Deps } from '#http/lib/deps.ts'

/** Things only the people who run the instance need to hear about. */
export const dashboardInstanceRoutes: FastifyPluginAsync<Deps.Dashboard> = async (app, deps) => {
  app.get('/instance/notices', async (req) => {
    const change = (await isInstanceAdmin(deps.db, currentUser(req).id))
      ? await getPublicUrlChange(deps.db)
      : undefined
    return {
      publicUrlChange: change ? { ...change, checklist: publicUrlChecklist(change) } : null,
    }
  })

  app.post('/instance/notices/public-url/dismiss', async (req, reply) => {
    if (!(await isInstanceAdmin(deps.db, currentUser(req).id))) {
      return reply.code(403).send({ error: 'Only instance admins can do this' })
    }
    await dismissPublicUrlChange(deps.db)
    return reply.code(204).send()
  })
}
