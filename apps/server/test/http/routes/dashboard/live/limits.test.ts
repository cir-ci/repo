import { emitLive } from '@circi/db/queue'
import { emitUserLive } from '@circi/services'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { startDashboard } from '#test/support/dashboard-fixture.ts'

/** The caps on `GET /api/live`, what a client that leaves early leaves behind, and which notices reload a person's scope. */

let stats: { streams(): number; subscribers(): number } | undefined
const fx = await startDashboard(
  {},
  {
    liveHeartbeatMs: 60_000,
    live: {
      maxStreams: 3,
      maxPerUser: 2,
      scopeReloadMinMs: 0,
      onStats: (s) => void (stats = s),
    },
  },
)
let base: string
beforeAll(async () => {
  await fx.app.listen({ host: '127.0.0.1', port: 0 })
  const address = fx.app.server.address()
  if (address === null || typeof address === 'string') throw new Error('the server has no port')
  base = `http://127.0.0.1:${address.port}`
})
afterAll(() => fx.close())

interface Stream {
  res: Response
  text(): string
  ended(): boolean
  close(): void
}

async function open(cookie: string): Promise<Stream> {
  const abort = new AbortController()
  const res = await fetch(`${base}/api/live`, { headers: { cookie }, signal: abort.signal })
  let text = ''
  let ended = false
  if (res.status === 200 && res.body) {
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
  return { res, text: () => text, ended: () => ended, close: () => abort.abort() }
}

describe('live stream limits', () => {
  it("ends the same person's oldest stream, cleanly, when they open more than their share", async () => {
    const first = await open(fx.acmeCookie)
    const second = await open(fx.acmeCookie)
    await expect.poll(() => first.text() + second.text()).toMatch(/retry:[\s\S]*retry:/)
    const third = await open(fx.acmeCookie)
    expect(third.res.status).toBe(200)
    await expect.poll(() => first.ended()).toBe(true)
    expect(second.ended()).toBe(false)
    second.close()
    third.close()
    await expect.poll(() => stats?.streams()).toBe(0)
  })

  it('refuses a new stream beyond the process cap with a 503 and Retry-After, and takes one again when a stream leaves', async () => {
    const a = await open(fx.acmeCookie)
    const b = await open(fx.acmeCookie)
    const c = await open(fx.rivalCookie)
    await expect.poll(() => stats?.streams()).toBe(3)
    const refused = await open(fx.rivalCookie)
    expect(refused.res.status).toBe(503)
    expect(Number(refused.res.headers.get('retry-after'))).toBeGreaterThan(0)
    a.close()
    await expect.poll(() => stats?.streams()).toBe(2)
    const again = await open(fx.rivalCookie)
    expect(again.res.status).toBe(200)
    for (const s of [b, c, again]) s.close()
    await expect.poll(() => stats?.streams()).toBe(0)
  })

  it('leaves no subscriber, timer or slot behind when the client leaves while the feed is still starting', async () => {
    // A fresh server whose first LISTEN is held until the client has gone.
    const timers = vi.spyOn(globalThis, 'setInterval')
    const before = timers.mock.calls.length
    const { promise: gate, resolve: release } = Promise.withResolvers<void>()
    let slowStats: { streams(): number; subscribers(): number } | undefined
    const slow = await startDashboard(
      {},
      {
        beforeListen: () => gate,
        live: { onStats: (s) => void (slowStats = s) },
      },
    )
    try {
      await slow.app.listen({ host: '127.0.0.1', port: 0 })
      const address = slow.app.server.address()
      if (address === null || typeof address === 'string') throw new Error('no port')
      const abort = new AbortController()
      const pending = fetch(`http://127.0.0.1:${address.port}/api/live`, {
        headers: { cookie: slow.acmeCookie },
        signal: abort.signal,
      }).catch(() => undefined)
      await expect.poll(() => slowStats?.streams()).toBe(1)
      abort.abort()
      await pending
      await expect.poll(() => slowStats?.streams()).toBe(0)
      release()
      await new Promise((resolve) => setTimeout(resolve, 100))
      expect(slowStats?.streams()).toBe(0)
      expect(slowStats?.subscribers()).toBe(0)
      expect(timers.mock.calls.length).toBe(before)
    } finally {
      timers.mockRestore()
      await slow.close()
    }
  })
})

describe("which notices reload a person's scope", () => {
  it('ignores a notice about a workspace the person is not in, without loading anything', async () => {
    const s = await open(fx.acmeCookie)
    await expect.poll(() => s.text()).toContain('retry:')
    const select = vi.spyOn(fx.db, 'select')
    try {
      await emitLive(fx.db, {
        type: 'build.updated',
        projectId: fx.rival.project.id,
        workspaceId: fx.rival.project.workspaceId,
        build: 1,
      })
      // Their own marker arrives after, in order: the foreign notice has been handled by then.
      await emitUserLive(fx.db, 'notification.created', fx.acme.owner.id)
      await expect.poll(() => s.text()).toContain('notification.created')
      expect(select).not.toHaveBeenCalled()
    } finally {
      select.mockRestore()
      s.close()
    }
  })

  it('loads the scope once for an unknown project and remembers it is not theirs', async () => {
    const s = await open(fx.acmeCookie)
    await expect.poll(() => s.text()).toContain('retry:')
    const unknown = '00000000-0000-4000-8000-000000000001'
    const select = vi.spyOn(fx.db, 'select')
    try {
      await emitLive(fx.db, {
        type: 'triage.changed',
        projectId: unknown,
        workspaceId: fx.acme.project.workspaceId,
      })
      await emitUserLive(fx.db, 'notification.created', fx.acme.owner.id)
      await expect.poll(() => s.text()).toContain('notification.created')
      const afterFirst = select.mock.calls.length
      expect(afterFirst).toBeGreaterThan(0)
      await emitLive(fx.db, {
        type: 'triage.changed',
        projectId: unknown,
        workspaceId: fx.acme.project.workspaceId,
      })
      await emitUserLive(fx.db, 'notification.read', fx.acme.owner.id)
      await expect.poll(() => s.text()).toContain('notification.read')
      expect(select.mock.calls.length).toBe(afterFirst)
    } finally {
      select.mockRestore()
      s.close()
    }
  })
})
