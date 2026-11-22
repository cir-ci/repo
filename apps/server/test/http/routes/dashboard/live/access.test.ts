import type { Live } from '@circi/api'
import { createUser } from '@circi/auth'
import { emitBuildLive, emitUserLive } from '@circi/services'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { JSON_HEADERS } from '#test/support/client.ts'
import { startDashboard } from '#test/support/dashboard-fixture.ts'
import { addMember, signIn } from '#test/support/helpers.ts'

/**
 * Access changes reach an open stream at once, not at the next heartbeat: the heartbeat here is a
 * minute, longer than any test, so only the notices can do it.
 */

const fx = await startDashboard({}, { liveHeartbeatMs: 60_000 })
let base: string
beforeAll(async () => {
  await fx.app.listen({ host: '127.0.0.1', port: 0 })
  const address = fx.app.server.address()
  if (address === null || typeof address === 'string') throw new Error('the server has no port')
  base = `http://127.0.0.1:${address.port}`
})
afterAll(() => fx.close())

interface Stream {
  text(): string
  events(): Live.Event[]
  ended(): boolean
  close(): void
}

const opened = new Set<Stream>()
async function stream(cookie: string): Promise<Stream> {
  const abort = new AbortController()
  const res = await fetch(`${base}/api/live`, { headers: { cookie }, signal: abort.signal })
  let text = ''
  let ended = false
  if (res.body) {
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    void (async () => {
      try {
        for (;;) {
          // oxlint-disable-next-line no-await-in-loop -- reading a stream in order
          const { done, value } = await reader.read()
          if (done) break
          text += decoder.decode(value, { stream: true })
        }
      } catch {
        // aborted by the test
      }
      ended = true
    })()
  }
  const s: Stream = {
    text: () => text,
    events: () =>
      text
        .split('\n')
        .filter((l) => l.startsWith('data: '))
        .map((l): Live.Event => JSON.parse(l.slice(6))),
    ended: () => ended,
    close: () => abort.abort(),
  }
  opened.add(s)
  await expect.poll(() => s.text()).toContain('retry:')
  return s
}
afterAll(() => {
  for (const s of opened) s.close()
})

const acmeBuild = () => ({ projectId: fx.acme.project.id, number: 2 })
const json = JSON_HEADERS

/** A member of acme (no project membership) with a signed-in session, and what the owner needs to change their seat. */
async function newMember(name: string) {
  const who = { email: `${name}@acme.test`, password: 'member-password-long-1' }
  const user = await createUser(fx.auth, { ...who, name })
  await addMember(fx.auth, fx.db, {
    workspaceSlug: fx.acme.workspaceSlug,
    email: who.email,
    role: 'member',
    projects: false,
  })
  const cookie = await signIn(fx.app, who.email, who.password)
  const roster = await fx.app.inject({
    method: 'GET',
    url: `/api/auth/organization/get-full-organization?organizationSlug=${fx.acme.workspaceSlug}`,
    headers: { cookie: fx.acmeCookie },
  })
  const body: { id: string; members: { id: string; user: { email: string } }[] } = roster.json()
  const seat = body.members.find((m) => m.user.email === who.email)
  return { cookie, seatId: seat?.id ?? '', workspaceId: body.id, who, userId: user.id }
}

describe('access changes on an open stream', () => {
  it('ends the stream of a signed-out session at once, and only that session', async () => {
    const out = await signIn(fx.app, fx.acme.owner.email, fx.acme.owner.password)
    const staying = await signIn(fx.app, fx.acme.owner.email, fx.acme.owner.password)
    const leaving = await stream(out)
    const kept = await stream(staying)
    const res = await fx.app.inject({
      method: 'POST',
      url: '/api/auth/sign-out',
      headers: { ...json, cookie: out },
      payload: {},
    })
    expect(res.statusCode).toBe(200)
    await expect.poll(() => leaving.ended(), { timeout: 3000 }).toBe(true)
    await emitUserLive(fx.db, 'notification.created', fx.acme.owner.id)
    await expect.poll(() => kept.events()).toEqual([{ type: 'notification.created' }])
    expect(kept.ended()).toBe(false)
  })

  it('ends the stream when its person signs out everywhere', async () => {
    const m = await newMember('revoked')
    const s = await stream(m.cookie)
    const sessions = await fx.app.inject({
      method: 'POST',
      url: '/api/auth/revoke-sessions',
      headers: { ...json, cookie: m.cookie },
      payload: {},
    })
    expect(sessions.statusCode).toBe(200)
    await expect.poll(() => s.ended(), { timeout: 3000 }).toBe(true)
  })

  it('stops sending a removed member their workspace the moment they are removed', async () => {
    const m = await newMember('leaving')
    await fx.app.inject({
      method: 'POST',
      url: '/api/auth/organization/update-member-role',
      headers: { ...json, cookie: fx.acmeCookie },
      payload: { memberId: m.seatId, role: 'admin', organizationId: m.workspaceId },
    })
    const s = await stream(m.cookie)
    await emitBuildLive(fx.db, 'build.updated', acmeBuild())
    await expect.poll(() => s.events().length).toBe(1)
    const removed = await fx.app.inject({
      method: 'POST',
      url: '/api/auth/organization/remove-member',
      headers: { ...json, cookie: fx.acmeCookie },
      payload: { memberIdOrEmail: m.seatId, organizationId: m.workspaceId },
    })
    expect(removed.statusCode).toBe(200)
    // Their stream is still open but the workspace is gone from what it may hear. The marker
    // (a notice for their own inbox) arrives after the build notice, in order, so once it is
    // here the build notice has been dropped.
    await emitBuildLive(fx.db, 'build.updated', acmeBuild())
    await emitUserLive(fx.db, 'notification.read', m.userId)
    await expect
      .poll(() => s.events())
      .toEqual([expect.objectContaining({ type: 'build.updated' }), { type: 'notification.read' }])
  })

  it('applies a role change at once: an admin hears projects they are not in', async () => {
    const m = await newMember('promoted')
    const s = await stream(m.cookie)
    await emitBuildLive(fx.db, 'build.updated', acmeBuild())
    await emitUserLive(fx.db, 'notification.created', m.userId)
    // A plain member outside the project hears nothing of it: the marker, after it in order, is all there is.
    await expect.poll(() => s.events()).toEqual([{ type: 'notification.created' }])
    const changed = await fx.app.inject({
      method: 'POST',
      url: '/api/auth/organization/update-member-role',
      headers: { ...json, cookie: fx.acmeCookie },
      payload: { memberId: m.seatId, role: 'admin', organizationId: m.workspaceId },
    })
    expect(changed.statusCode).toBe(200)
    // The stream reloads its scope on the notice; wait for it to take effect, then it hears.
    await expect
      .poll(
        async () => {
          await emitBuildLive(fx.db, 'build.updated', acmeBuild())
          return s.events().some((e) => e.type === 'build.updated')
        },
        { timeout: 3000 },
      )
      .toBe(true)
  })
})
