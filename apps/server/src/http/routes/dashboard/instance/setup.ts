import { createWorkspace, createUser, deleteNewUser, isSetupCode } from '@circi/auth'
import { assertValidSlug, slugify, ValidationError } from '@circi/core'
import { countUsers } from '@circi/db/queries'
import { beginFirstRunSetup } from '@circi/services'
import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'

import { requireSameOrigin } from '#http/hooks/same-origin.ts'
import type { Deps } from '#http/lib/deps.ts'
import { parse } from '#http/lib/validation.ts'

const codeBody = z.object({ code: z.string() })
const body = codeBody.extend({
  name: z.string().min(1).max(100),
  email: z.string().max(320),
  password: z.string().max(256),
  workspaceName: z.string().min(1).max(100),
  /** The workspace's address; made from its name when left out. */
  workspaceSlug: z.string().max(100).optional(),
  /** The dashboard's setup steps made this request and will go on with the storage check and the first team. */
  steps: z.boolean().optional(),
})

const WRONG_CODE = 'That setup code is wrong. Find it in the server log.'

/**
 * First-run setup, so a fresh install needs no command line. It is steps in the dashboard; the
 * server needs two requests while there are no accounts:
 *
 * - `POST /api/setup/code` checks the setup code (the first step, so a wrong one is found early);
 * - `POST /api/setup` creates the first account (an instance admin) and its workspace as one:
 *   everything is validated first, and if the workspace can't be made the account is removed
 *   again, so a failure leaves nothing and the steps start over. With `steps: true` (the
 *   dashboard's own request) it then notes that the storage check and the first team are still to
 *   do (`GET /api/capabilities` says `setupPending`, and `POST /api/instance/setup/finish` ends
 *   it), which is how a reload resumes at the right step; a script that sends no `steps` gets
 *   the account and workspace and nothing more.
 *
 * Both need the setup code from the server's log, so a stranger who finds the dashboard first
 * can't claim it. Once any account exists they answer "not found" for good.
 */
export const dashboardSetupRoutes: FastifyPluginAsync<
  Pick<Deps.Dashboard, 'db' | 'auth' | 'publicOrigin'> & { secret: string }
> = async (app, deps) => {
  app.get('/api/setup', async () => ({ needed: (await countUsers(deps.db)) === 0 }))

  app.post(
    '/api/setup/code',
    { onRequest: requireSameOrigin(deps.publicOrigin) },
    async (req, reply) => {
      if ((await countUsers(deps.db)) > 0) return reply.code(404).send({ error: 'Not found' })
      const input = parse(codeBody, req.body)
      if (!isSetupCode(deps.secret, input.code)) return reply.code(403).send({ error: WRONG_CODE })
      return reply.code(204).send()
    },
  )

  app.post(
    '/api/setup',
    { onRequest: requireSameOrigin(deps.publicOrigin) },
    async (req, reply) => {
      if ((await countUsers(deps.db)) > 0) return reply.code(404).send({ error: 'Not found' })
      const input = parse(body, req.body)
      if (!isSetupCode(deps.secret, input.code)) return reply.code(403).send({ error: WRONG_CODE })
      // Everything the workspace needs is checked before the account exists.
      const slug = input.workspaceSlug?.trim() || slugify(input.workspaceName)
      if (!input.workspaceName.trim()) throw new ValidationError('Workspace name is required')
      assertValidSlug(slug, 'workspace address')
      const user = await createUser(deps.auth, {
        email: input.email,
        name: input.name,
        password: input.password,
        instanceAdmin: true,
      })
      try {
        const workspace = await createWorkspace(deps.auth, deps.db, {
          name: input.workspaceName,
          slug,
          ownerEmail: user.email,
        })
        if (input.steps) await beginFirstRunSetup(deps.db)
        return await reply
          .code(201)
          .send({ email: user.email, workspace: { slug: workspace.slug } })
      } catch (error) {
        // No half-made instance: the account goes, and the steps start again.
        await deleteNewUser(deps.auth, user.id)
        throw error
      }
    },
  )
}
