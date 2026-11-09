import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { addMember, createUser } from '@circi/auth'
import {
  getWorkspaceBySlug,
  recordSessionMethod,
  schema,
  setWorkspaceAuthSettings,
} from '@circi/db'
import { FsStorage } from '@circi/storage'
import { createTestDb, seedInvitation } from '@circi/testing'
import { eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { pino } from 'pino'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { buildServer } from '#http/app.ts'
import { caller } from '#test/support/client.ts'
import { snapshotDb } from '#test/support/db-snapshot.ts'
import { createTestAuth, ORIGIN, seedTenant, signIn, type Tenant } from '#test/support/helpers.ts'

/**
 * Per-workspace GitHub and Google switches. Sessions are real (signed in through `/api/auth`);
 * a session is then marked as having come through GitHub (what the single sign-on callback
 * records, which `session-created.test.ts` covers in `@circi/auth`): GitHub's own OAuth
 * endpoints are not faked here.
 */
let t: createTestDb.Result
let dir: string
let app: FastifyInstance
let withoutGithub: FastifyInstance
let auth: ReturnType<typeof createTestAuth>
const sso = [
  { id: 'github', name: 'GitHub' },
  { id: 'google', name: 'Google' },
]

beforeAll(async () => {
  t = await createTestDb()
  dir = await mkdtemp(join(tmpdir(), 'circi-signin-'))
  auth = createTestAuth(t.db)
  const deps = { db: t.db, auth, storage: new FsStorage({ path: dir }), publicOrigin: ORIGIN }
  app = buildServer({ logger: pino({ level: 'silent' }), checks: [], dashboard: { ...deps, sso } })
  withoutGithub = buildServer({ logger: pino({ level: 'silent' }), checks: [], dashboard: deps })
  await Promise.all([app.ready(), withoutGithub.ready()])
})
afterAll(async () => {
  await Promise.all([app.close(), withoutGithub.close()])
  await t.close()
  await rm(dir, { recursive: true, force: true })
})

/** Signs in with a password, then records that session as one that came through `provider`. */
async function signInVia(
  email: string,
  password: string,
  provider: 'github' | 'google',
): Promise<string> {
  const cookie = await signIn(app, email, password)
  const [user] = await t.db.select().from(schema.user).where(eq(schema.user.email, email))
  const sessions = await t.db
    .select()
    .from(schema.session)
    .where(eq(schema.session.userId, user?.id ?? ''))
  const newest = sessions.toSorted((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0]
  await recordSessionMethod(t.db, newest?.id ?? '', 'oidc', undefined, provider)
  return cookie
}

const GITHUB_REFUSAL = "This workspace doesn't allow sign-in with GitHub"

describe('per-workspace GitHub and Google sign-in', () => {
  let acme: Tenant
  let other: Tenant
  let passwordCookie: string
  let githubCookie: string
  let reset: () => Promise<void>

  beforeAll(async () => {
    acme = await seedTenant(auth, t.db)
    other = await seedTenant(auth, t.db)
    passwordCookie = await signIn(app, acme.owner.email, acme.owner.password)
    githubCookie = await signInVia(acme.owner.email, acme.owner.password, 'github')
    reset = await snapshotDb(t)
  })
  beforeEach(() => reset())

  it('shows the switches only for providers the instance has, on by default', async () => {
    const res = await caller(app)(
      'GET',
      `/api/workspaces/${acme.workspaceSlug}/auth`,
      passwordCookie,
    )
    expect(res.json()).toMatchObject({
      settings: { signinGithub: true, signinGoogle: true },
      instance: { github: true, google: true },
    })
    const bare = await caller(withoutGithub)(
      'GET',
      `/api/workspaces/${acme.workspaceSlug}/auth`,
      await signIn(withoutGithub, acme.owner.email, acme.owner.password),
    )
    expect(bare.json().instance).toMatchObject({ github: false, google: false })
  })

  it('refuses a GitHub session with 403 and the reason once GitHub is off, and only there', async () => {
    const off = await caller(app)(
      'PATCH',
      `/api/workspaces/${acme.workspaceSlug}/auth`,
      passwordCookie,
      { signinGithub: false },
    )
    expect(off.statusCode).toBe(200)
    expect(off.json().settings).toMatchObject({ signinGithub: false, signinGoogle: true })

    for (const url of [
      `/api/teams/${acme.workspaceSlug}/web`,
      `/api/workspaces/${acme.workspaceSlug}/auth`,
      `/api/workspaces/${acme.workspaceSlug}/settings`,
    ]) {
      // eslint-disable-next-line no-await-in-loop -- a few requests
      const res = await caller(app)('GET', url, githubCookie)
      expect([url, res.statusCode]).toEqual([url, 403])
      expect(res.json().error).toBe(GITHUB_REFUSAL)
    }
    // Lists leave the workspace out, and the capabilities say why.
    expect((await caller(app)('GET', '/api/teams', githubCookie)).json().teams).toEqual([])
    const caps = (await caller(app)('GET', '/api/capabilities', githubCookie)).json()
    expect(caps.refusingWorkspaces).toEqual([
      { name: expect.any(String), accepts: ['password', 'email', 'google'] },
    ])
    // The same person's password session, and other workspaces, are untouched.
    expect(
      (await caller(app)('GET', `/api/teams/${acme.workspaceSlug}/web`, passwordCookie)).statusCode,
    ).toBe(200)
    const otherCookie = await signInVia(other.owner.email, other.owner.password, 'github')
    expect(
      (await caller(app)('GET', `/api/teams/${other.workspaceSlug}/web`, otherCookie)).statusCode,
    ).toBe(200)
    // And so is a person outside the workspace: plain "not found".
    expect(
      (await caller(app)('GET', `/api/teams/${acme.workspaceSlug}/web`, otherCookie)).statusCode,
    ).toBe(404)
  })

  it('turns it back on', async () => {
    await caller(app)('PATCH', `/api/workspaces/${acme.workspaceSlug}/auth`, passwordCookie, {
      signinGithub: false,
    })
    expect(
      (await caller(app)('GET', `/api/teams/${acme.workspaceSlug}/web`, githubCookie)).statusCode,
    ).toBe(403)
    await caller(app)('PATCH', `/api/workspaces/${acme.workspaceSlug}/auth`, passwordCookie, {
      signinGithub: true,
    })
    expect(
      (await caller(app)('GET', `/api/teams/${acme.workspaceSlug}/web`, githubCookie)).statusCode,
    ).toBe(200)
  })

  it('never locks out an instance admin', async () => {
    const admin = await createUser(auth, {
      email: 'boss@acme.test',
      name: 'Boss',
      password: 'password-for-the-boss-1',
      instanceAdmin: true,
    })
    await addMember(auth, t.db, {
      workspaceSlug: acme.workspaceSlug,
      email: admin.email,
      role: 'member',
    })
    const adminCookie = await signInVia(admin.email, 'password-for-the-boss-1', 'github')
    await caller(app)('PATCH', `/api/workspaces/${acme.workspaceSlug}/auth`, passwordCookie, {
      signinGithub: false,
    })
    expect(
      (await caller(app)('GET', `/api/teams/${acme.workspaceSlug}/web`, adminCookie)).statusCode,
    ).toBe(200)
    await caller(app)('PATCH', `/api/workspaces/${acme.workspaceSlug}/auth`, passwordCookie, {
      signinGithub: true,
    })
  })

  it('refuses to accept an invitation through a method the workspace does not allow', async () => {
    await caller(app)('PATCH', `/api/workspaces/${acme.workspaceSlug}/auth`, passwordCookie, {
      signinGithub: false,
    })
    const workspace = await getWorkspaceBySlug(t.db, acme.workspaceSlug)
    const guest = await createUser(auth, {
      email: 'guest@elsewhere.test',
      name: 'Guest',
      password: 'password-for-the-guest-1',
    })
    const invitation = await seedInvitation(t.db, {
      workspaceId: workspace.id,
      inviterId: acme.owner.id,
      email: guest.email,
    })
    const viaGithub = await signInVia(guest.email, 'password-for-the-guest-1', 'github')
    const refused = await caller(app)(
      'POST',
      '/api/auth/organization/accept-invitation',
      viaGithub,
      {
        invitationId: invitation.id,
      },
    )
    expect(refused.statusCode).toBe(403)
    expect(refused.json().message).toBe(GITHUB_REFUSAL)
    expect(
      await t.db.select().from(schema.member).where(eq(schema.member.userId, guest.id)),
    ).toHaveLength(0)

    // The same invitation through a password session works.
    const viaPassword = await signIn(app, guest.email, 'password-for-the-guest-1')
    const ok = await caller(app)('POST', '/api/auth/organization/accept-invitation', viaPassword, {
      invitationId: invitation.id,
    })
    expect(ok.statusCode).toBe(200)
    expect(
      await t.db.select().from(schema.member).where(eq(schema.member.userId, guest.id)),
    ).toHaveLength(1)
  })

  it('refuses a switch that would lock every owner out', async () => {
    // An owner whose only way in is GitHub, with email codes off for the workspace.
    const github = await seedTenant(auth, t.db)
    const workspace = await getWorkspaceBySlug(t.db, github.workspaceSlug)
    await t.db.delete(schema.account).where(eq(schema.account.userId, github.owner.id))
    await t.db.insert(schema.account).values({
      id: `gh-${github.owner.id}`,
      accountId: 'gh-1',
      providerId: 'github',
      userId: github.owner.id,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    await setWorkspaceAuthSettings(
      t.db,
      workspace.id,
      { emailLoginEnabled: false },
      { instance: { password: true, email: false, github: true, google: true, oidc: false } },
    )
    await expect(
      setWorkspaceAuthSettings(
        t.db,
        workspace.id,
        { signinGithub: false },
        { instance: { password: true, email: false, github: true, google: true, oidc: false } },
      ),
    ).rejects.toThrow(/no owner able to sign in/)
  })
})
