import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { InstanceAdmin, Workspace } from '@circi/api'
import { addMember, createUser } from '@circi/auth'
import { getWorkspaceBySlug } from '@circi/db/queries'
import * as schema from '@circi/db/schema'
import { runRetention } from '@circi/services'
import { FsStorage } from '@circi/storage'
import { createTestDb } from '@circi/testing'
import { eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { pino } from 'pino'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { buildServer } from '#http/app.ts'
import { caller } from '#test/support/client.ts'
import { createTestAuth, ORIGIN, seedTenant, signIn, type Tenant } from '#test/support/helpers.ts'

let t: createTestDb.Result
let dir: string
let app: FastifyInstance
let auth: ReturnType<typeof createTestAuth>
let adminCookie: string

beforeAll(async () => {
  t = await createTestDb()
  dir = await mkdtemp(join(tmpdir(), 'circi-delete-'))
  auth = createTestAuth(t.db)
  const deps = { db: t.db, auth, storage: new FsStorage({ path: dir }), publicOrigin: ORIGIN }
  app = buildServer({
    logger: pino({ level: 'silent' }),
    checks: [],
    dashboard: deps,
    api: deps,
  })
  await app.ready()
  await createUser(auth, {
    email: 'root@acme.test',
    name: 'Root',
    password: 'root-password-long-1',
    instanceAdmin: true,
  })
  adminCookie = await signIn(app, 'root@acme.test', 'root-password-long-1')
})
afterAll(async () => {
  await app.close()
  await t.close()
  await rm(dir, { recursive: true, force: true })
})

const call = caller(() => app)

interface Setup {
  tenant: Tenant
  ownerCookie: string
  adminMemberCookie: string
  memberCookie: string
  name: string
}
async function setup(): Promise<Setup> {
  const tenant = await seedTenant(auth, t.db)
  const people = await Promise.all(
    (['admin', 'member'] as const).map(async (role) => {
      const email = `${role}-${tenant.workspaceSlug}@acme.test`
      const password = `password-for-${role}-long-1`
      await createUser(auth, { email, name: role, password })
      await addMember(auth, t.db, { workspaceSlug: tenant.workspaceSlug, email, role })
      return signIn(app, email, password)
    }),
  )
  const workspace = await getWorkspaceBySlug(t.db, tenant.workspaceSlug)
  return {
    tenant,
    ownerCookie: await signIn(app, tenant.owner.email, tenant.owner.password),
    adminMemberCookie: people[0] ?? '',
    memberCookie: people[1] ?? '',
    name: workspace.name,
  }
}

const del = (s: Setup, cookie: string, confirm: string = s.name) =>
  call('DELETE', `/api/workspaces/${s.tenant.workspaceSlug}`, cookie, { confirm })

const memberRoutes = (s: Setup) => [
  `/api/teams/${s.tenant.workspaceSlug}/web`,
  `/api/teams/${s.tenant.workspaceSlug}/web/settings`,
  `/api/teams/${s.tenant.workspaceSlug}/web/snapshots/home/history`,
  `/api/workspaces/${s.tenant.workspaceSlug}`,
  `/api/workspaces/${s.tenant.workspaceSlug}/auth`,
  `/api/workspaces/${s.tenant.workspaceSlug}/settings`,
  `/api/workspaces/${s.tenant.workspaceSlug}/builds`,
]
const statuses = async (cookie: string, urls: string[]) =>
  Promise.all(urls.map(async (url) => (await call('GET', url, cookie)).statusCode))

const upload = (token: string) =>
  app.inject({
    method: 'POST',
    url: '/v1/builds',
    headers: { authorization: `Bearer ${token}` },
    payload: { commitSha: 'abcdef1', branch: 'main', files: [] },
  })

describe('deleting a workspace', () => {
  it('is for owners: a member and an admin get 403, and a wrong name changes nothing', async () => {
    const s = await setup()
    expect((await del(s, s.memberCookie)).statusCode).toBe(403)
    expect((await del(s, s.adminMemberCookie)).statusCode).toBe(403)
    const wrong = await del(s, s.ownerCookie, 'not the name')
    expect(wrong.statusCode).toBe(400)
    expect(await statuses(s.ownerCookie, memberRoutes(s))).toEqual(memberRoutes(s).map(() => 200))
  })

  it('hides it at once: member routes answer 404, lists leave it out, uploads are refused', async () => {
    const s = await setup()
    expect((await upload(s.tenant.token)).statusCode).toBe(201)

    const res = await del(s, s.ownerCookie)
    expect(res.statusCode).toBe(200)
    const { purgeAt } = res.json<Workspace.Deleted>()
    expect(new Date(purgeAt).getTime() - Date.now()).toBeGreaterThan(29.9 * 86_400_000)

    for (const cookie of [s.ownerCookie, s.adminMemberCookie, s.memberCookie]) {
      // eslint-disable-next-line no-await-in-loop -- a few requests
      expect(await statuses(cookie, memberRoutes(s))).toEqual(memberRoutes(s).map(() => 404))
      // eslint-disable-next-line no-await-in-loop
      const teams = (await call('GET', '/api/teams', cookie)).json<{ teams: unknown[] }>().teams
      expect(JSON.stringify(teams)).not.toContain(s.tenant.workspaceSlug)
      // eslint-disable-next-line no-await-in-loop
      const caps = (await call('GET', '/api/capabilities', cookie)).json<Workspace.Capabilities>()
      expect(JSON.stringify(caps.manageableWorkspaces)).not.toContain(s.tenant.workspaceSlug)
    }
    // CI tokens stop working.
    expect((await upload(s.tenant.token)).statusCode).toBe(401)
    // The address stays reserved.
    const again = await call('POST', '/api/instance/workspaces', adminCookie, {
      name: 'Taken',
      slug: s.tenant.workspaceSlug,
      ownerEmail: 'root@acme.test',
    })
    expect(again.statusCode).toBeGreaterThanOrEqual(400)
    expect(JSON.stringify(again.json())).toMatch(/slug|taken|exist/i)
  })

  it('shows it to instance admins as deleted with the days left, and restoring brings everything back', async () => {
    const s = await setup()
    await del(s, s.ownerCookie)
    const list = (
      await call('GET', '/api/instance/workspaces', adminCookie)
    ).json<InstanceAdmin.WorkspaceList>()
    const found = list.workspaces.find((w) => w.slug === s.tenant.workspaceSlug)
    expect(found).toMatchObject({ daysLeft: 30 })
    expect(found?.deletedAt).not.toBeNull()

    // Only instance admins restore.
    expect(
      (await call('POST', `/api/instance/workspaces/${found?.id}/restore`, s.ownerCookie, {}))
        .statusCode,
    ).toBe(403)
    const restored = await call(
      'POST',
      `/api/instance/workspaces/${found?.id}/restore`,
      adminCookie,
      {},
    )
    expect(restored.statusCode).toBe(200)
    expect(restored.json<{ workspace: InstanceAdmin.Workspace }>().workspace).toMatchObject({
      deletedAt: null,
      daysLeft: null,
    })
    expect(await statuses(s.memberCookie, memberRoutes(s))).toEqual(memberRoutes(s).map(() => 200))
    expect((await upload(s.tenant.token)).statusCode).toBe(201)
    expect(
      (await call('POST', `/api/instance/workspaces/${found?.id}/restore`, adminCookie, {}))
        .statusCode,
    ).toBe(409)
  })

  it('can be purged at once by an instance admin, only after it was deleted', async () => {
    const s = await setup()
    const workspace = await getWorkspaceBySlug(t.db, s.tenant.workspaceSlug)
    const live = await call(
      'POST',
      `/api/instance/workspaces/${workspace.id}/purge`,
      adminCookie,
      {},
    )
    expect(live.statusCode).toBe(409)
    await del(s, s.ownerCookie)
    const purged = await call(
      'POST',
      `/api/instance/workspaces/${workspace.id}/purge`,
      adminCookie,
      {},
    )
    expect(purged.statusCode).toBe(204)
    expect(
      await t.db.select().from(schema.workspace).where(eq(schema.workspace.id, workspace.id)),
    ).toEqual([])
  })

  it('is purged by retention after 30 days', async () => {
    const s = await setup()
    const workspace = await getWorkspaceBySlug(t.db, s.tenant.workspaceSlug)
    await del(s, s.ownerCookie)
    const deletedAt = new Date(Date.now() - 30 * 86_400_000)
    await t.db
      .update(schema.workspaceDeletions)
      .set({ deletedAt })
      .where(eq(schema.workspaceDeletions.workspaceId, workspace.id))
    const result = await runRetention(t.db, {
      deleteObject: async () => {},
      now: new Date(deletedAt.getTime() + 30 * 86_400_000),
    })
    expect(result.purgedWorkspaces).toBeGreaterThanOrEqual(1)
    expect(
      await t.db.select().from(schema.teams).where(eq(schema.teams.workspaceId, workspace.id)),
    ).toEqual([])
  })
})
