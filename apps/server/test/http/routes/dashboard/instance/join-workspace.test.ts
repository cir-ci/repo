import type { InstanceAdmin } from '@circi/api'
import { createUser } from '@circi/auth'
import { getMemberRole, getWorkspaceBySlug } from '@circi/db/queries'
import { createTestDb } from '@circi/db/testing'
import { FsStorage } from '@circi/storage'
import { useTempDir } from '@circi/testing'
import type { FastifyInstance } from 'fastify'
import { pino } from 'pino'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { buildServer } from '#http/app.ts'
import { caller } from '#test/support/client.ts'
import { createTestAuth, ORIGIN, seedTenant, signIn } from '#test/support/helpers.ts'

let t: createTestDb.Result
const tempDir = useTempDir('circi-join')
let app: FastifyInstance
let auth: ReturnType<typeof createTestAuth>
let adminId: string
let adminCookie: string
let plainCookie: string

beforeAll(async () => {
  t = await createTestDb()
  auth = createTestAuth(t.db)
  const deps = {
    db: t.db,
    auth,
    storage: new FsStorage({ path: tempDir.path }),
    publicOrigin: ORIGIN,
  }
  app = buildServer({ logger: pino({ level: 'silent' }), checks: [], dashboard: deps, api: deps })
  await app.ready()
  const root = await createUser(auth, {
    email: 'root@acme.test',
    name: 'Root',
    password: 'root-password-long-1',
    instanceAdmin: true,
  })
  adminId = root.id
  adminCookie = await signIn(app, 'root@acme.test', 'root-password-long-1')
  await createUser(auth, { email: 'plain@acme.test', name: 'Plain', password: 'plain-password-1' })
  plainCookie = await signIn(app, 'plain@acme.test', 'plain-password-1')
})
afterAll(async () => {
  await app.close()
  await t.close()
})

const call = caller(() => app)

describe('POST /api/instance/workspaces/:id/join', () => {
  it('makes an instance admin who is not in the workspace an admin of it', async () => {
    const tenant = await seedTenant(auth, t.db)
    const ws = await getWorkspaceBySlug(t.db, tenant.workspaceSlug)
    expect(await getMemberRole(t.db, { userId: adminId, workspaceId: ws.id })).toBeUndefined()

    const res = await call('POST', `/api/instance/workspaces/${ws.id}/join`, adminCookie, {})
    expect(res.statusCode).toBe(200)
    expect(res.json<InstanceAdmin.Joined>().workspace).toMatchObject({
      id: ws.id,
      youAreMember: true,
    })
    expect(await getMemberRole(t.db, { userId: adminId, workspaceId: ws.id })).toBe('admin')
    const settings = await call('GET', `/api/workspaces/${tenant.workspaceSlug}`, adminCookie)
    expect(settings.statusCode).toBe(200)
  })

  it('refuses someone who is not an instance admin with 403, and adds no one', async () => {
    const tenant = await seedTenant(auth, t.db)
    const ws = await getWorkspaceBySlug(t.db, tenant.workspaceSlug)
    const url = `/api/instance/workspaces/${ws.id}/join`
    expect((await call('POST', url, plainCookie, {})).statusCode).toBe(403)
    const owner = await signIn(app, tenant.owner.email, tenant.owner.password)
    expect((await call('POST', url, owner, {})).statusCode).toBe(403)
    expect((await call('POST', url, '', {})).statusCode).toBe(401)
  })

  it('answers 409 when they are already a member, and keeps their role', async () => {
    const tenant = await seedTenant(auth, t.db)
    const ws = await getWorkspaceBySlug(t.db, tenant.workspaceSlug)
    const url = `/api/instance/workspaces/${ws.id}/join`
    expect((await call('POST', url, adminCookie, {})).statusCode).toBe(200)
    expect((await call('POST', url, adminCookie, {})).statusCode).toBe(409)
    expect(await getMemberRole(t.db, { userId: adminId, workspaceId: ws.id })).toBe('admin')
  })

  it('answers 404 for a deleted workspace and for one that does not exist', async () => {
    const tenant = await seedTenant(auth, t.db)
    const ws = await getWorkspaceBySlug(t.db, tenant.workspaceSlug)
    const owner = await signIn(app, tenant.owner.email, tenant.owner.password)
    const del = await call('DELETE', `/api/workspaces/${tenant.workspaceSlug}`, owner, {
      confirm: ws.slug,
    })
    expect(del.statusCode).toBe(200)
    const res = await call('POST', `/api/instance/workspaces/${ws.id}/join`, adminCookie, {})
    expect(res.statusCode).toBe(404)
    expect(await getMemberRole(t.db, { userId: adminId, workspaceId: ws.id })).toBeUndefined()
    const missing = await call('POST', '/api/instance/workspaces/nope/join', adminCookie, {})
    expect(missing.statusCode).toBe(404)
  })
})
