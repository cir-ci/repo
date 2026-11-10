import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createUser } from '@circi/auth'
import type { Auth } from '@circi/auth'
import * as schema from '@circi/db/schema'
import { addTestMember, createTestDb } from '@circi/db/testing'
import { FsStorage } from '@circi/storage'
import { fakeIdp, type FakeIdp } from '@circi/testing/hosts'
import { eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { pino } from 'pino'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { buildServer } from '#http/app.ts'
import { JSON_HEADERS } from '#test/support/client.ts'
import { snapshotDb } from '#test/support/db-snapshot.ts'
import { createTestAuth, ORIGIN, seedTenant, signIn, type Tenant } from '#test/support/helpers.ts'

let t: createTestDb.Result
let dir: string
let app: FastifyInstance
let auth: Auth
let idp: FakeIdp
let acme: Tenant
let rival: Tenant
let ownerCookie: string
let reset: () => Promise<void>

beforeAll(async () => {
  t = await createTestDb()
  idp = await fakeIdp('client-1')
  dir = await mkdtemp(join(tmpdir(), 'circi-orgsso-'))
  auth = createTestAuth(t.db)
  app = buildServer({
    logger: pino({ level: 'silent' }),
    checks: [],
    dashboard: {
      db: t.db,
      auth,
      storage: new FsStorage({ path: dir }),
      publicOrigin: ORIGIN,
      // The stand-in provider listens on 127.0.0.1.
      webhookAllowPrivate: true,
    },
  })
  await app.ready()
  acme = await seedTenant(auth, t.db)
  rival = await seedTenant(auth, t.db)
  ownerCookie = await signIn(app, acme.owner.email, acme.owner.password)
  reset = await snapshotDb(t)
})
beforeEach(() => reset())
afterAll(async () => {
  await app.close()
  await idp.close()
  await t.close()
  await rm(dir, { recursive: true, force: true })
})

const base = () => `/api/workspaces/${acme.workspaceSlug}/sso`

/** Signs in through the workspace's provider; returns the session cookie, or the failure. */
async function ssoSignIn(slug: string): Promise<{ cookie: string; location: string }> {
  const start = await app.inject({
    method: 'POST',
    url: '/api/auth/sign-in/sso',
    headers: JSON_HEADERS,
    payload: { organizationSlug: slug, callbackURL: '/', errorCallbackURL: '/?failed' },
  })
  expect(start.statusCode).toBe(200)
  const cookies = [start.headers['set-cookie']]
    .flat()
    .map((c) => String(c).split(';')[0])
    .join('; ')
  const authorize = await fetch(start.json().url, { redirect: 'manual' })
  const callback = new URL(authorize.headers.get('location') ?? '')
  const done = await app.inject({
    method: 'GET',
    url: callback.pathname + callback.search,
    headers: { cookie: cookies },
  })
  const session = [done.headers['set-cookie']]
    .flat()
    .filter(Boolean)
    .map((c) => String(c).split(';')[0])
    .join('; ')
  return { cookie: session, location: done.headers.location ?? '' }
}

/** Registers the fake provider for Acme as its owner. */
const registerProvider = () =>
  app.inject({
    method: 'POST',
    url: base(),
    headers: { ...JSON_HEADERS, cookie: ownerCookie },
    payload: { issuer: idp.issuer, clientId: 'client-1', clientSecret: 'shh' },
  })

const ann = { sub: 'emp-1', email: 'ann@acme-corp.test', name: 'Ann', email_verified: true }

describe("a workspace's own single sign-on", () => {
  it('lets an owner register a provider, showing the address to register, never the secret', async () => {
    const res = await registerProvider()
    expect(res.statusCode).toBe(201)
    expect(res.json().provider.redirectUri).toBe(
      `${ORIGIN}/api/auth/sso/callback/${acme.workspaceSlug}-sso`,
    )

    const list = await app.inject({ url: base(), headers: { cookie: ownerCookie } })
    expect(list.json().providers).toHaveLength(1)
    expect(list.body).not.toContain('shh')
  })

  it('signs a new person in, as an unverified member of that workspace only', async () => {
    expect((await registerProvider()).statusCode).toBe(201)
    idp.identity = ann
    const { cookie, location } = await ssoSignIn(acme.workspaceSlug)
    expect(location).not.toContain('failed')
    expect(cookie).not.toBe('')

    const sidebar = await app.inject({
      url: `/api/workspaces/${acme.workspaceSlug}/sidebar`,
      headers: { cookie },
    })
    expect(sidebar.statusCode).toBe(200)
    // Signing in puts nobody in a team.
    expect((await app.inject({ url: '/api/teams', headers: { cookie } })).json().teams).toEqual([])

    const [user] = await t.db
      .select()
      .from(schema.user)
      .where(eq(schema.user.email, 'ann@acme-corp.test'))
    // Whatever the provider says about the address, the account starts unverified.
    expect(user?.emailVerified).toBe(false)
    const members = await t.db
      .select()
      .from(schema.member)
      .where(eq(schema.member.userId, user?.id ?? ''))
    expect(members.map((m) => m.role)).toEqual(['member'])
  })

  it('opens only its own workspace, even if the person also belongs to another', async () => {
    expect((await registerProvider()).statusCode).toBe(201)
    idp.identity = ann
    expect((await ssoSignIn(acme.workspaceSlug)).cookie).not.toBe('')
    const [user] = await t.db
      .select()
      .from(schema.user)
      .where(eq(schema.user.email, 'ann@acme-corp.test'))
    const [rivalWorkspace] = await t.db
      .select()
      .from(schema.workspace)
      .where(eq(schema.workspace.slug, rival.workspaceSlug))
    await addTestMember(t.db, { workspaceId: rivalWorkspace?.id ?? '', userId: user?.id ?? '' })
    const { cookie } = await ssoSignIn(acme.workspaceSlug)
    const open = (slug: string) =>
      app.inject({ url: `/api/workspaces/${slug}/sidebar`, headers: { cookie } })
    expect((await open(acme.workspaceSlug)).statusCode).toBe(200)
    expect((await open(rival.workspaceSlug)).statusCode).toBe(404)
    expect(
      (await app.inject({ url: `/api/teams/${rival.workspaceSlug}/web`, headers: { cookie } }))
        .statusCode,
    ).toBe(404)
    const caps = (await app.inject({ url: '/api/capabilities', headers: { cookie } })).json()
    expect(caps.canCreateWorkspace).toBe(false)
  })

  it('matches people by their identity, not by email: a returning person is the same account', async () => {
    expect((await registerProvider()).statusCode).toBe(201)
    idp.identity = ann
    expect((await ssoSignIn(acme.workspaceSlug)).cookie).not.toBe('')
    idp.identity = {
      sub: 'emp-1',
      email: 'ann.new-name@acme-corp.test',
      name: 'Ann',
      email_verified: true,
    }
    const { cookie } = await ssoSignIn(acme.workspaceSlug)
    expect(cookie).not.toBe('')
    const users = await t.db.select().from(schema.user).where(eq(schema.user.name, 'Ann'))
    expect(users).toHaveLength(1)
  })

  it('refuses a provider claiming an address that already belongs to another account', async () => {
    expect((await registerProvider()).statusCode).toBe(201)
    await createUser(auth, {
      email: 'victim@corp.test',
      name: 'Victim',
      password: 'victim-password-1',
    })
    idp.identity = {
      sub: 'attacker-1',
      email: 'victim@corp.test',
      name: 'Mallory',
      email_verified: true,
    }
    const { cookie, location } = await ssoSignIn(acme.workspaceSlug)
    expect(cookie).not.toContain('session_token')
    expect(location).toContain('failed')
    const [victim] = await t.db
      .select()
      .from(schema.user)
      .where(eq(schema.user.email, 'victim@corp.test'))
    const accounts = await t.db
      .select()
      .from(schema.account)
      .where(eq(schema.account.userId, victim?.id ?? ''))
    expect(accounts.map((a) => a.providerId)).toEqual(['credential'])
  })

  it('only owners and admins of the workspace can manage it; others see "not found"', async () => {
    const rivalCookie = await signIn(app, rival.owner.email, rival.owner.password)
    expect((await app.inject({ url: base(), headers: { cookie: rivalCookie } })).statusCode).toBe(
      404,
    )
    const del = await app.inject({
      method: 'DELETE',
      url: `/api/workspaces/${rival.workspaceSlug}/sso/${acme.workspaceSlug}-sso`,
      headers: { cookie: rivalCookie, origin: ORIGIN },
    })
    expect(del.statusCode).toBe(404)
  })

  it('answers 400, saying so, when the issuer cannot be reached', async () => {
    for (const issuer of ['https://unreachable.invalid', 'http://127.0.0.1:9']) {
      // oxlint-disable-next-line no-await-in-loop -- tiny fixed list
      const res = await app.inject({
        method: 'POST',
        url: base(),
        headers: { ...JSON_HEADERS, cookie: ownerCookie },
        payload: { issuer, clientId: 'client-1', clientSecret: 'shh' },
      })
      expect(res.statusCode).toBe(400)
      expect(res.json().error).toContain("Couldn't reach that issuer")
      expect(res.json().error).toContain(new URL(issuer).host)
    }
  })

  it('says plainly when the issuer answers but has no discovery document', async () => {
    const plain = createServer((_req, res) => {
      res.statusCode = 404
      res.end('nope')
    })
    await new Promise<void>((resolve) => plain.listen(0, '127.0.0.1', resolve))
    try {
      const address = plain.address()
      const port = typeof address === 'object' && address ? address.port : 0
      const res = await app.inject({
        method: 'POST',
        url: base(),
        headers: { ...JSON_HEADERS, cookie: ownerCookie },
        payload: { issuer: `http://127.0.0.1:${port}`, clientId: 'client-1', clientSecret: 'shh' },
      })
      expect(res.statusCode).toBe(400)
      expect(res.json().error).toBe(
        'That address has no OpenID Connect discovery document (/.well-known/openid-configuration).',
      )
      expect(res.json().fields).toHaveProperty('issuer')
    } finally {
      plain.close()
    }
  })

  it('removes the provider, after which nobody can sign in through it', async () => {
    expect((await registerProvider()).statusCode).toBe(201)
    const del = await app.inject({
      method: 'DELETE',
      url: `${base()}/${acme.workspaceSlug}-sso`,
      headers: { cookie: ownerCookie, origin: ORIGIN },
    })
    expect(del.statusCode).toBe(204)
    const start = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-in/sso',
      headers: JSON_HEADERS,
      payload: { organizationSlug: acme.workspaceSlug, callbackURL: '/' },
    })
    expect(start.statusCode).toBeGreaterThanOrEqual(400)
  })
})
