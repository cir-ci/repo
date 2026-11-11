import { createUser } from '@circi/auth'
import type { SessionMethod } from '@circi/db/repositories'
import { createTestDb } from '@circi/db/testing'
import Fastify from 'fastify'

import { jsonErrorHandler } from '#http/lib/errors.ts'
import { loadProject } from '#http/lib/project-access.ts'
import { loadWorkspace } from '#http/lib/workspace-access.ts'

import { createTestAuth, seedTenant, addMember } from './helpers.ts'

/**
 * `loadProject` and `loadWorkspace` on their own: a bare server whose "session" is two headers
 * (`x-user`, and `x-method` as JSON), with one route per helper variant, so the access rules
 * can be tested without the dashboard around them. The routes answer 200 `{ ok, role }` when
 * the helper let the caller through.
 */
export async function startAccess() {
  const t = await createTestDb()
  const auth = createTestAuth(t.db)
  const acme = await seedTenant(auth, t.db)
  const rival = await seedTenant(auth, t.db)

  const roles = ['admin', 'member', 'outsider'] as const
  const ids = await Promise.all(
    roles.map(async (role) => {
      const email = `${role}@access.test`
      const created = await createUser(auth, {
        email,
        name: role,
        password: `${role}-password-long-1`,
      })
      if (role !== 'outsider') {
        await addMember(auth, t.db, { workspaceSlug: acme.workspaceSlug, email, role })
      }
      return created.id
    }),
  )
  const people = { admin: ids[0] ?? '', member: ids[1] ?? '', outsider: ids[2] ?? '' }

  const deps = { db: t.db }
  const app = Fastify()
  app.decorateRequest('user', undefined)
  app.addHook('onRequest', async (req) => {
    const id = req.headers['x-user']
    const header = req.headers['x-method']
    if (typeof id === 'string') {
      const method: SessionMethod = typeof header === 'string' ? JSON.parse(header) : 'password'
      req.user = {
        id,
        email: `${id}@access.test`,
        name: id,
        method,
        sessionId: 'session',
      }
    }
  })
  app.setErrorHandler(jsonErrorHandler)
  app.get('/project/:workspace/:project', async (req) => {
    const found = await loadProject(deps, req)
    return { ok: true, project: found.project.slug }
  })
  app.get('/manage/:workspace/:project', async (req) => {
    const found = await loadProject(deps, req, { manage: true })
    return { ok: true, project: found.project.slug }
  })
  app.get('/workspace/:workspace', async (req) => {
    const found = await loadWorkspace(deps, req)
    return { ok: true, workspace: found.workspace.slug }
  })
  await app.ready()

  return {
    acme,
    rival,
    people: { ...people, acmeOwner: acme.owner.id, rivalOwner: rival.owner.id },
    /** GET `url` as `userId` (nobody when omitted), with the session's login method. */
    get: (url: string, userId?: string, method?: SessionMethod) =>
      app.inject({
        method: 'GET',
        url,
        headers: {
          ...(userId ? { 'x-user': userId } : {}),
          ...(method ? { 'x-method': JSON.stringify(method) } : {}),
        },
      }),
    async close() {
      await app.close()
      await t.close()
    },
  }
}
