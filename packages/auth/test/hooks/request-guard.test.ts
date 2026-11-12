import { recordSessionMethod, setWorkspaceAuthSettings } from '@circi/db/repositories'
import * as schema from '@circi/db/schema'
import { createTestDb } from '@circi/db/testing'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { type Auth, createAuth, createUser, createWorkspace } from '#src/index.ts'

let t: createTestDb.Result
let auth: Auth
beforeAll(async () => {
  t = await createTestDb()
  auth = createAuth({
    db: t.db,
    secret: 'test-secret-that-is-long-enough-1234',
    baseURL: 'http://localhost:3000',
    mailer: { send: () => Promise.resolve() },
  })
})
afterAll(async () => {
  await t.close()
})
beforeEach(async () => {
  await t.reset()
})

const PASSWORD = 'a-long-enough-password'
const instance = { password: true, email: true, github: true, google: true, oidc: false }

let n = 0
/** A member (or owner) of a fresh workspace, signed in with a password; the session's headers. */
async function memberOfWorkspace(options: { instanceAdmin?: boolean } = {}) {
  n += 1
  const owner = await createUser(auth, {
    email: `owner${n}@guard.test`,
    name: `Owner ${n}`,
    password: PASSWORD,
    ...(options.instanceAdmin ? { instanceAdmin: true } : {}),
  })
  const slug = `guard-${n}`
  const workspace = await createWorkspace(auth, t.db, {
    name: `Guard ${n}`,
    slug,
    ownerEmail: owner.email,
  })
  const { headers: signedIn } = await auth.api.signInEmail({
    body: { email: owner.email, password: PASSWORD },
    returnHeaders: true,
  })
  const headers = new Headers({
    cookie: (signedIn.get('set-cookie') ?? '')
      .split(/,(?=\s*[\w.-]+=)/)
      .map((c) => c.split(';')[0]?.trim())
      .filter(Boolean)
      .join('; '),
  })
  const [session] = await t.db
    .select({ id: schema.session.id })
    .from(schema.session)
    .where(eq(schema.session.userId, owner.id))
  if (!session) throw new Error('no session')
  return { owner, slug, workspaceId: workspace.id, headers, sessionId: session.id }
}

const open = (slug: string, headers: Headers) =>
  auth.api.getFullOrganization({ query: { organizationSlug: slug }, headers })

const ask = (email: string) => auth.api.sendVerificationOTP({ body: { email, type: 'sign-in' } })

describe('requestGuard: sign-in codes', () => {
  it('lets an address ask five times, then refuses the sixth with a retry message', async () => {
    for (let i = 0; i < 5; i += 1) {
      // eslint-disable-next-line no-await-in-loop -- counted in order
      await expect(ask('busy@guard.test')).resolves.toEqual({ success: true })
    }
    await expect(ask('busy@guard.test')).rejects.toMatchObject({
      statusCode: 429,
      message: 'Too many sign-in codes requested for this address. Try again later.',
    })
  })

  it('counts an address however it is cased, and leaves other addresses alone', async () => {
    for (let i = 0; i < 5; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await ask(i % 2 ? 'Busy@Guard.test' : 'busy@guard.test')
    }
    await expect(ask('BUSY@guard.test')).rejects.toMatchObject({ statusCode: 429 })
    await expect(ask('calm@guard.test')).resolves.toEqual({ success: true })
  })

  it('counts addresses that have no account too, so refusing reveals nothing', async () => {
    for (let i = 0; i < 5; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await ask('nobody@guard.test')
    }
    await expect(ask('nobody@guard.test')).rejects.toMatchObject({ statusCode: 429 })
  })
})

describe('requestGuard: every path that sends a code shares the per-address limit', () => {
  const ways = [
    [
      '/forget-password/email-otp',
      (email: string) => auth.api.forgetPasswordEmailOTP({ body: { email } }),
    ],
    [
      '/email-otp/request-password-reset',
      (email: string) => auth.api.requestPasswordResetEmailOTP({ body: { email } }),
    ],
  ] as const

  it.each(ways)('%s is limited with the sign-in code requests', async (_path, request) => {
    for (let i = 0; i < 3; i += 1) {
      // eslint-disable-next-line no-await-in-loop -- counted in order
      await ask('shared@guard.test')
    }
    await request('shared@guard.test')
    await request('shared@guard.test')
    await expect(request('shared@guard.test')).rejects.toMatchObject({ statusCode: 429 })
    await expect(ask('shared@guard.test')).rejects.toMatchObject({ statusCode: 429 })
  })
})

describe('requestGuard: workspace endpoints', () => {
  it('lets a member whose login method the workspace accepts open it', async () => {
    const { slug, headers } = await memberOfWorkspace()
    expect((await open(slug, headers))?.slug).toBe(slug)
  })

  it('tells a member signed in through a provider the workspace switched off why, with a 403', async () => {
    const { slug, headers, sessionId, workspaceId } = await memberOfWorkspace()
    await recordSessionMethod(t.db, sessionId, 'oidc', undefined, 'github')
    await setWorkspaceAuthSettings(t.db, workspaceId, { signinGithub: false }, { instance })
    await expect(open(slug, headers)).rejects.toMatchObject({
      statusCode: 403,
      message: "This workspace doesn't allow sign-in with GitHub",
    })
  })

  it('applies the same rule when the workspace is named by id in the body', async () => {
    const { headers, sessionId, workspaceId } = await memberOfWorkspace()
    await recordSessionMethod(t.db, sessionId, 'oidc', undefined, 'google')
    await setWorkspaceAuthSettings(t.db, workspaceId, { signinGoogle: false }, { instance })
    await expect(
      auth.api.setActiveOrganization({ body: { organizationId: workspaceId }, headers }),
    ).rejects.toMatchObject({
      statusCode: 403,
      message: "This workspace doesn't allow sign-in with Google",
    })
  })

  it('does not tell an instance admin about the provider rule, but still hides the workspace', async () => {
    const { slug, headers, sessionId, workspaceId } = await memberOfWorkspace({
      instanceAdmin: true,
    })
    await recordSessionMethod(t.db, sessionId, 'oidc', undefined, 'github')
    await setWorkspaceAuthSettings(t.db, workspaceId, { signinGithub: false }, { instance })
    await expect(open(slug, headers)).rejects.toMatchObject({
      statusCode: 404,
      message: 'Workspace not found',
    })
  })

  it('answers "not found" for a session scoped to another workspace', async () => {
    const { slug, headers, sessionId } = await memberOfWorkspace()
    const other = await memberOfWorkspace()
    await recordSessionMethod(t.db, sessionId, 'workspace-oidc', other.workspaceId)
    await expect(open(slug, headers)).rejects.toMatchObject({
      statusCode: 404,
      message: 'Workspace not found',
    })
  })

  it('opens the workspace a scoped session belongs to', async () => {
    const { slug, headers, sessionId, workspaceId } = await memberOfWorkspace()
    await recordSessionMethod(t.db, sessionId, 'workspace-oidc', workspaceId)
    expect((await open(slug, headers))?.slug).toBe(slug)
  })

  it('refuses a password session once the workspace switched passwords off', async () => {
    const { slug, headers, workspaceId } = await memberOfWorkspace()
    await setWorkspaceAuthSettings(
      t.db,
      workspaceId,
      { passwordLoginEnabled: false },
      { instance, force: true },
    )
    await expect(open(slug, headers)).rejects.toMatchObject({ statusCode: 404 })
  })

  it('leaves a request without a session to better-auth (unauthenticated)', async () => {
    const { slug } = await memberOfWorkspace()
    await expect(open(slug, new Headers())).rejects.toMatchObject({ statusCode: 401 })
  })

  it('leaves a request that names no workspace alone', async () => {
    const { headers } = await memberOfWorkspace()
    await expect(auth.api.listOrganizations({ headers })).resolves.toHaveLength(1)
  })

  it('leaves a workspace that does not exist to better-auth', async () => {
    const { headers } = await memberOfWorkspace()
    // The guard has nothing to refuse; whatever answers is better-auth, not a login-method rule.
    const answer = await open('no-such-workspace', headers).then(
      () => undefined,
      (err: { message?: string }) => err.message,
    )
    expect(answer).not.toMatch(/doesn't allow sign-in/)
  })
})
