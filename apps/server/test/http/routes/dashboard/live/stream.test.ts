import type { Live } from '@circi/api'
import { createUser } from '@circi/auth'
import { findProjectForMember, getBuildByNumber } from '@circi/db/queries'
import { addComment, emitBuildLive, emitUserLive } from '@circi/services'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { startDashboard } from '#test/support/dashboard-fixture.ts'
import { ORIGIN, addMember, signIn } from '#test/support/helpers.ts'

/**
 * `GET /api/live` over a real socket (a stream never ends, so `app.inject` can't read it). The
 * database feed is PGlite's LISTEN/NOTIFY, which behaves like Postgres's for this; the pg
 * connection in production (`createDb().listen`) is covered by the same `ListenFn` contract only
 * against the dev stack.
 */

const fx = await startDashboard({}, { liveHeartbeatMs: 150 })
let base: string
beforeAll(async () => {
  await fx.app.listen({ host: '127.0.0.1', port: 0 })
  const address = fx.app.server.address()
  if (address === null || typeof address === 'string') throw new Error('the server has no port')
  base = `http://127.0.0.1:${address.port}`
})
afterAll(() => fx.close())

interface Stream {
  status: number
  /** Everything received so far, as text. */
  text(): string
  events(): Live.Event[]
  ended(): boolean
  close(): void
}

async function open(cookie: string): Promise<Stream> {
  const abort = new AbortController()
  const res = await fetch(`${base}/api/live`, {
    headers: cookie ? { cookie } : {},
    signal: abort.signal,
  })
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
  return {
    status: res.status,
    text: () => text,
    events: () =>
      text
        .split('\n')
        .filter((l) => l.startsWith('data: '))
        .map((l): Live.Event => JSON.parse(l.slice(6))),
    ended: () => ended,
    close: () => abort.abort(),
  }
}

const opened = new Set<Stream>()
async function stream(cookie: string): Promise<Stream> {
  const s = await open(cookie)
  opened.add(s)
  return s
}
afterAll(() => {
  for (const s of opened) s.close()
})

const acmeProject = () => ({ projectId: fx.acme.project.id, number: 2 })

describe('GET /api/live', () => {
  it('needs a session', async () => {
    const res = await fetch(`${base}/api/live`)
    expect(res.status).toBe(401)
  })

  it('answers as an event stream and tells the browser when to retry', async () => {
    const s = await stream(fx.acmeCookie)
    expect(s.status).toBe(200)
    await expect.poll(() => s.text()).toContain('retry: 5000')
  })

  it('sends a project member the events of their project, as the slugs and number their routes use', async () => {
    const s = await stream(fx.acmeCookie)
    await expect.poll(() => s.text()).toContain('retry:')
    await emitBuildLive(fx.db, 'build.updated', acmeProject())
    await expect
      .poll(() => s.events())
      .toEqual([
        { type: 'build.updated', workspace: fx.acme.workspaceSlug, project: 'web', build: 2 },
      ])
  })

  it('carries a real change: a comment on the build', async () => {
    const s = await stream(fx.acmeCookie)
    await expect.poll(() => s.text()).toContain('retry:')
    const build = await getBuildByNumber(fx.db, fx.acme.project.id, 2)
    await addComment(fx.db, { buildId: build?.id ?? '', authorId: fx.acme.owner.id, body: 'hi' })
    await expect
      .poll(() => s.events())
      .toEqual([
        { type: 'comment.changed', workspace: fx.acme.workspaceSlug, project: 'web', build: 2 },
      ])
  })

  it("never sends another workspace's events", async () => {
    const rival = await stream(fx.rivalCookie)
    await expect.poll(() => rival.text()).toContain('retry:')
    await emitBuildLive(fx.db, 'build.updated', acmeProject())
    // The rival's own marker comes after, in order: had the acme event been sent it would be first.
    await emitUserLive(fx.db, 'notification.created', fx.rival.owner.id)
    await expect.poll(() => rival.events()).toEqual([{ type: 'notification.created' }])
  })

  it("never sends a member the events of a project they can't see, but does send them their own", async () => {
    const who = { email: 'plain@acme.test', password: 'plain-password-long-1' }
    const user = await createUser(fx.auth, { ...who, name: 'Plain' })
    await addMember(fx.auth, fx.db, {
      workspaceSlug: fx.acme.workspaceSlug,
      email: who.email,
      role: 'member',
      projects: false,
    })
    const cookie = await signIn(fx.app, who.email, who.password)
    expect(
      await findProjectForMember(fx.db, {
        workspaceSlug: fx.acme.workspaceSlug,
        projectSlug: 'web',
        userId: user.id,
      }),
    ).toBeUndefined()
    const s = await stream(cookie)
    await expect.poll(() => s.text()).toContain('retry:')
    await emitBuildLive(fx.db, 'build.updated', acmeProject())
    await emitUserLive(fx.db, 'notification.created', user.id)
    await emitUserLive(fx.db, 'notification.created', fx.acme.owner.id)
    await expect.poll(() => s.events()).toEqual([{ type: 'notification.created' }])
    // Give the stream room to (wrongly) send more.
    await new Promise((r) => setTimeout(r, 100))
    expect(s.events()).toEqual([{ type: 'notification.created' }])
  })

  it('sends an inbox event to its person only', async () => {
    const acme = await stream(fx.acmeCookie)
    const rival = await stream(fx.rivalCookie)
    await expect.poll(() => acme.text() + rival.text()).toMatch(/retry:[\s\S]*retry:/)
    await emitUserLive(fx.db, 'notification.read', fx.acme.owner.id)
    await expect.poll(() => acme.events()).toEqual([{ type: 'notification.read' }])
    await emitUserLive(fx.db, 'notification.created', fx.rival.owner.id)
    await expect.poll(() => rival.events()).toEqual([{ type: 'notification.created' }])
    expect(acme.events()).toEqual([{ type: 'notification.read' }])
  })

  it('sends a heartbeat comment while quiet', async () => {
    const s = await stream(fx.acmeCookie)
    await expect.poll(() => s.text(), { timeout: 3000 }).toContain(': ping')
  })

  it('ends once the session is gone, so the next connection gets the 401', async () => {
    const cookie = await signIn(fx.app, fx.acme.owner.email, fx.acme.owner.password)
    const s = await stream(cookie)
    await expect.poll(() => s.text()).toContain('retry:')
    const out = await fx.app.inject({
      method: 'POST',
      url: '/api/auth/sign-out',
      headers: { origin: ORIGIN, cookie, 'content-type': 'application/json' },
      payload: {},
    })
    expect(out.statusCode).toBe(200)
    await expect.poll(() => s.ended(), { timeout: 3000 }).toBe(true)
    expect((await fetch(`${base}/api/live`, { headers: { cookie } })).status).toBe(401)
  })
})
