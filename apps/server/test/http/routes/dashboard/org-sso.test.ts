import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createUser } from '@circi/auth'
import type { Auth } from '@circi/auth'
import { schema } from '@circi/db'
import { FsStorage } from '@circi/storage'
import { addTestMember, createTestDb } from '@circi/testing'
import { eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { pino } from 'pino'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { buildServer } from '#http/app.ts'
import { type FakeIdp, startFakeIdp } from '#test/support/fake-idp.ts'
import { createTestAuth, ORIGIN, seedTenant, signIn, type Tenant } from '#test/support/helpers.ts'

let t: createTestDb.Result
let dir: string
let app: FastifyInstance
let auth: Auth
let idp: FakeIdp
let acme: Tenant
let rival: Tenant
let ownerCookie: string
const json = { origin: ORIGIN, 'content-type': 'application/json' }

beforeAll(async () => {
  t = await createTestDb()
  idp = await startFakeIdp('client-1')
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
})
afterAll(async () => {
  await app.close()
  await idp.close()
  await t.close()
  await rm(dir, { recursive: true, force: true })
})

const base = () => `/api/organizations/${acme.orgSlug}/sso`

/** Signs in through the organization's provider; returns the session cookie, or the failure. */
async function ssoSignIn(slug: string): Promise<{ cookie: string; location: string }> {
  const start = await app.inject({
    method: 'POST',
    url: '/api/auth/sign-in/sso',
    headers: json,
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

describe('an organization’s own single sign-on', () => {
  it('lets an owner register a provider, showing the address to register, never the secret', async () => {
    const res = await app.inject({
      method: 'POST',
      url: base(),
      headers: { ...json, cookie: ownerCookie },
      payload: { issuer: idp.issuer, clientId: 'client-1', clientSecret: 'shh' },
    })
    expect(res.statusCode).toBe(201)
    expect(res.json().provider.redirectUri).toBe(
      `${ORIGIN}/api/auth/sso/callback/${acme.orgSlug}-sso`,
    )

    const list = await app.inject({ url: base(), headers: { cookie: ownerCookie } })
    expect(list.json().providers).toHaveLength(1)
    expect(list.body).not.toContain('shh')
  })

  it('signs a new person in, as an unverified member of that organization only', async () => {
    idp.identity = { sub: 'emp-1', email: 'ann@acme-corp.test', name: 'Ann', email_verified: true }
    const { cookie, location } = await ssoSignIn(acme.orgSlug)
    expect(location).not.toContain('failed')
    expect(cookie).not.toBe('')

    const projects = (await app.inject({ url: '/api/projects', headers: { cookie } })).json()
      .projects
    expect(projects.map((p: { org: { slug: string } }) => p.org.slug)).toEqual([acme.orgSlug])

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

  it('opens only its own organization, even if the person also belongs to another', async () => {
    const [user] = await t.db
      .select()
      .from(schema.user)
      .where(eq(schema.user.email, 'ann@acme-corp.test'))
    const [rivalOrg] = await t.db
      .select()
      .from(schema.organization)
      .where(eq(schema.organization.slug, rival.orgSlug))
    await addTestMember(t.db, { orgId: rivalOrg?.id ?? '', userId: user?.id ?? '' })
    const { cookie } = await ssoSignIn(acme.orgSlug)
    const projects = (await app.inject({ url: '/api/projects', headers: { cookie } })).json()
      .projects
    expect(projects.map((p: { org: { slug: string } }) => p.org.slug)).toEqual([acme.orgSlug])
    expect(
      (await app.inject({ url: `/api/projects/${rival.orgSlug}/web`, headers: { cookie } }))
        .statusCode,
    ).toBe(404)
    const caps = (await app.inject({ url: '/api/capabilities', headers: { cookie } })).json()
    expect(caps.canCreateOrganization).toBe(false)
  })

  it('matches people by their identity, not by email: a returning person is the same account', async () => {
    idp.identity = {
      sub: 'emp-1',
      email: 'ann.new-name@acme-corp.test',
      name: 'Ann',
      email_verified: true,
    }
    const { cookie } = await ssoSignIn(acme.orgSlug)
    expect(cookie).not.toBe('')
    const users = await t.db.select().from(schema.user).where(eq(schema.user.name, 'Ann'))
    expect(users).toHaveLength(1)
  })

  it('refuses a provider claiming an address that already belongs to another account', async () => {
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
    const { cookie, location } = await ssoSignIn(acme.orgSlug)
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

  it('only owners and admins of the organization can manage it; others see "not found"', async () => {
    const rivalCookie = await signIn(app, rival.owner.email, rival.owner.password)
    expect((await app.inject({ url: base(), headers: { cookie: rivalCookie } })).statusCode).toBe(
      404,
    )
    const del = await app.inject({
      method: 'DELETE',
      url: `/api/organizations/${rival.orgSlug}/sso/${acme.orgSlug}-sso`,
      headers: { cookie: rivalCookie, origin: ORIGIN },
    })
    expect(del.statusCode).toBe(404)
  })

  it('removes the provider, after which nobody can sign in through it', async () => {
    const del = await app.inject({
      method: 'DELETE',
      url: `${base()}/${acme.orgSlug}-sso`,
      headers: { cookie: ownerCookie, origin: ORIGIN },
    })
    expect(del.statusCode).toBe(204)
    const start = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-in/sso',
      headers: json,
      payload: { organizationSlug: acme.orgSlug, callbackURL: '/' },
    })
    expect(start.statusCode).toBeGreaterThanOrEqual(400)
  })
})
