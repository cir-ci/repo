import type { Auth } from '@circi/auth'
import { createTestDb } from '@circi/db/testing'
import Fastify from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { currentProject, requireProjectToken } from '#http/hooks/project-token.ts'
import { createTestAuth, seedTenant, type Tenant } from '#test/support/helpers.ts'

let t: createTestDb.Result
let auth: Auth
let tenant: Tenant
const app = Fastify()

beforeAll(async () => {
  t = await createTestDb()
  auth = createTestAuth(t.db)
  tenant = await seedTenant(auth, t.db)
  app.addHook('onRequest', requireProjectToken(auth, t.db))
  app.get('/whoami', (req) => ({
    id: currentProject(req).project.id,
    workspace: currentProject(req).workspaceSlug,
  }))
  await app.ready()
})
afterAll(async () => {
  await app.close()
  await t.close()
})

const get = (headers: Record<string, string>) =>
  app.inject({ method: 'GET', url: '/whoami', headers })

describe('requireProjectToken', () => {
  it('accepts a project token as a Bearer header and sets the project', async () => {
    const res = await get({ authorization: `Bearer ${tenant.token}` })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ id: tenant.project.id, workspace: tenant.workspaceSlug })
  })

  it('answers 401 with a Bearer challenge when there is no header', async () => {
    const res = await get({})
    expect(res.statusCode).toBe(401)
    expect(res.headers['www-authenticate']).toBe('Bearer')
    expect(res.json().error).toMatch(/project token is required/)
  })

  it('answers 401 for a wrong token and for another auth scheme', async () => {
    expect((await get({ authorization: 'Bearer circi_nope' })).statusCode).toBe(401)
    expect((await get({ authorization: `Basic ${tenant.token}` })).statusCode).toBe(401)
    expect((await get({ authorization: 'Bearer ' })).statusCode).toBe(401)
  })
})
