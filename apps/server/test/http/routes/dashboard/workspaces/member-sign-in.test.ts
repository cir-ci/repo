import type { Workspace } from '@circi/api'
import { createUser } from '@circi/auth'
import * as schema from '@circi/db/schema'
import { createTestDb } from '@circi/db/testing'
import { FsStorage } from '@circi/storage'
import { useTempDir } from '@circi/testing'
import type { FastifyInstance } from 'fastify'
import { pino } from 'pino'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { buildServer } from '#http/app.ts'
import { caller } from '#test/support/client.ts'
import { createTestAuth, ORIGIN, seedTenant, signIn, addMember } from '#test/support/helpers.ts'

let t: createTestDb.Result
const tempDir = useTempDir('circi-signin-methods')
let app: FastifyInstance

beforeAll(async () => {
  t = await createTestDb()
  const auth = createTestAuth(t.db)
  const deps = {
    db: t.db,
    auth,
    storage: new FsStorage({ path: tempDir.path }),
    publicOrigin: ORIGIN,
  }
  app = buildServer({ logger: pino({ level: 'silent' }), checks: [], dashboard: deps, api: deps })
  await app.ready()
})
afterAll(async () => {
  await app.close()
  await t.close()
})

const call = caller(() => app)

describe('GET /api/workspaces/:workspace/members/sign-in', () => {
  it('tells owners and admins how each member can sign in, and nobody else', async () => {
    const auth = createTestAuth(t.db)
    const tenant = await seedTenant(auth, t.db)
    const slug = tenant.workspaceSlug
    const github = await createUser(auth, {
      email: `gh-${slug}@acme.test`,
      name: 'GitHub person',
      password: 'password-for-github-long-1',
    })
    await addMember(auth, t.db, { workspaceSlug: slug, email: github.email, role: 'member' })
    // A linked GitHub sign-in next to the password.
    await t.db.insert(schema.account).values({
      id: `acc-${slug}`,
      accountId: '42',
      providerId: 'github',
      userId: github.id,
      updatedAt: new Date(),
    })
    const memberCookie = await signIn(app, github.email, 'password-for-github-long-1')
    const ownerCookie = await signIn(app, tenant.owner.email, tenant.owner.password)

    const url = `/api/workspaces/${slug}/members/sign-in`
    const res = await call('GET', url, ownerCookie)
    expect(res.statusCode).toBe(200)
    const by = Object.fromEntries(
      res.json<Workspace.MembersSignIn>().members.map((m) => [m.userId, m.methods]),
    )
    expect(by[tenant.owner.id]).toEqual(['password'])
    expect(by[github.id]).toEqual(['password', 'github'])

    expect((await call('GET', url, memberCookie)).statusCode).toBe(403)
    expect((await call('GET', url, '')).statusCode).toBe(401)
  })
})
