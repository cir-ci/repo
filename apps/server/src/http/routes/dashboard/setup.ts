import { createOrganization, createUser, isSetupCode } from '@circi/auth'
import { countUsers } from '@circi/db'
import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'

import { requireSameOrigin } from '../../hooks/same-origin.ts'
import type { DashboardDeps } from '../../lib/deps.ts'
import { parse } from '../../lib/validation.ts'

const body = z.object({
  code: z.string(),
  name: z.string().min(1).max(100),
  email: z.string().max(320),
  password: z.string().max(256),
  organizationName: z.string().min(1).max(100),
})

/**
 * First-run setup, so a fresh install needs no command line: while there are no accounts at
 * all, `POST /api/setup` creates the first one (an instance admin) and its organization. It
 * needs the setup code from the server's log, so a stranger who finds the dashboard first
 * can't claim it. Once any account exists the endpoint answers "not found" for good.
 */
export const dashboardSetupRoutes: FastifyPluginAsync<
  Pick<DashboardDeps, 'db' | 'auth' | 'publicOrigin'> & { secret: string }
> = async (app, deps) => {
  app.get('/api/setup', async () => ({ needed: (await countUsers(deps.db)) === 0 }))

  app.post(
    '/api/setup',
    { onRequest: requireSameOrigin(deps.publicOrigin) },
    async (req, reply) => {
      if ((await countUsers(deps.db)) > 0) return reply.code(404).send({ error: 'Not found' })
      const input = parse(body, req.body)
      if (!isSetupCode(deps.secret, input.code)) {
        return reply
          .code(403)
          .send({ error: 'That setup code is wrong. Find it in the server log.' })
      }
      const user = await createUser(deps.auth, {
        email: input.email,
        name: input.name,
        password: input.password,
        instanceAdmin: true,
      })
      const org = await createOrganization(deps.auth, deps.db, {
        name: input.organizationName,
        ownerEmail: user.email,
      })
      return reply.code(201).send({ email: user.email, organization: { slug: org.slug } })
    },
  )
}
