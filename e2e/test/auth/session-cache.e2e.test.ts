import { SESSION_COOKIE_CACHE_SECONDS } from '@circi/auth'
import { describe, expect, it } from 'vitest'

import { signIn, type Session } from '#clients/admin.ts'
import { useStack } from '#stack/vitest.ts'

interface AuthSession {
  user?: { id: string; email: string }
  session?: { id: string }
}

const whoAmI = async (session: Session) => {
  const res = await session.request<AuthSession | null>('GET', '/api/auth/get-session')
  return { status: res.status, user: res.body?.user, session: res.body?.session }
}
const dashboard = (session: Session) => session.request('GET', '/api/projects')
const revokeOthers = (keep: Session) => keep.post('/api/auth/revoke-other-sessions')

/**
 * The session cookie cache (packages/auth/src/auth.ts): better-auth puts a signed copy of the
 * session in a cookie and trusts it for `SESSION_COOKIE_CACHE_SECONDS`, so a session that was
 * revoked or banned is still believed by better-auth's own `/api/auth/get-session` for that long.
 * CirCI's dashboard API does not rely on it: `requireSession` checks the session row on every
 * request. Both halves are pinned here, so the window that is documented is the window there is.
 */
describe('session cookie cache', () => {
  const ctx = useStack({ profile: 'default', setup: true })

  /** An account of its own with two signed-in sessions (two devices). */
  const twoDevices = async () => {
    const tenant = await ctx.tenant({ instanceAdmin: false })
    const second = await signIn(ctx.stack, tenant.account.email, tenant.account.password)
    const third = await signIn(ctx.stack, tenant.account.email, tenant.account.password)
    return { account: tenant.account, first: second, second: third }
  }

  it('a revoked session is refused at once by the dashboard API, and believed by get-session until the cache runs out', async () => {
    const signedInAt = Date.now()
    const { first, second } = await twoDevices()
    // The cookie carries the cached copy.
    expect(first.cookieHeader).toContain('session_data')
    expect((await dashboard(first)).status).toBe(200)
    expect((await whoAmI(first)).user).toBeDefined()

    // The second device signs the first one out (revoke other sessions): its row is gone.
    await revokeOthers(second)

    // The dashboard API checks the row on every request: refused at once, with the usual 401.
    const refused = await dashboard(first)
    expect(refused.status).toBe(401)
    expect(refused.body).toEqual({ error: 'Sign in to continue' })
    // The other device is untouched.
    expect((await dashboard(second)).status).toBe(200)

    // better-auth's own endpoint still answers from the cookie: the documented window.
    const stale = await whoAmI(first)
    expect(stale.status).toBe(200)
    expect(stale.session?.id).toBeDefined()
    expect(stale.user?.email).toBe(first.email)

    // ...and only for that long: once the cache is older than the window it asks the database.
    await expect
      .poll(async () => (await whoAmI(first)).session, {
        timeout: SESSION_COOKIE_CACHE_SECONDS * 1000 + 15_000,
        interval: 1_000,
      })
      .toBeUndefined()
    const elapsed = (Date.now() - signedInAt) / 1000
    expect(elapsed).toBeGreaterThanOrEqual(SESSION_COOKIE_CACHE_SECONDS - 5)
    expect(elapsed).toBeLessThanOrEqual(SESSION_COOKIE_CACHE_SECONDS + 15)
    // Still refused by the dashboard, of course.
    expect((await dashboard(first)).status).toBe(401)
  }, 120_000)

  it('a banned user is refused at once by the dashboard API, while get-session may still answer from the cache', async () => {
    const { account, first } = await twoDevices()
    const me = await whoAmI(first)
    expect(me.user?.id).toBeDefined()
    expect((await dashboard(first)).status).toBe(200)

    await ctx.admin.post(`/api/instance/accounts/${me.user?.id}/ban`, { reason: 'e2e ban' })

    const refused = await dashboard(first)
    expect(refused.status).toBe(401)
    expect(refused.body).toEqual({ error: 'Sign in to continue' })
    // Signing in again is refused too: the ban is real, not only a cache miss.
    await expect(signIn(ctx.stack, account.email, account.password)).rejects.toThrow(/sign-in/)
    // better-auth's own endpoint, inside the window, still believes the cookie.
    expect((await whoAmI(first)).user?.email).toBe(account.email)
  })

  it('a session that is signed out is refused at once by the dashboard API', async () => {
    const { first } = await twoDevices()
    expect((await dashboard(first)).status).toBe(200)
    // Keep the cookie of the session that is signed out: a real sign-out would clear it.
    const cookie = first.cookieHeader
    await first.signOut()
    const replay = await fetch(`${ctx.stack.url}/api/projects`, {
      headers: { cookie, origin: ctx.stack.url },
    })
    expect(replay.status).toBe(401)
  })
})
