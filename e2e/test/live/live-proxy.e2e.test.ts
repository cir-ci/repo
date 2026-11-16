import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { approveBuild, createProject } from '#clients/admin.ts'
import { LiveStream } from '#clients/live.ts'
import { uploadOrThrow } from '#clients/upload.ts'
import { Repo } from '#github/git-repo.ts'
import { useStack } from '#stack/vitest.ts'

/**
 * `GET /api/live` through Caddy, with the dashboard block of the shipped `deploy/Caddyfile`
 * (plain HTTP on port 80 instead of the real file's certificate, which needs the internet; Caddy
 * 2.10, the real deployment builds `caddy:2` with the Route53 module). The documentation says the
 * bundled Caddy needs no setting for live updates: this is the proof.
 */
describe('live updates through the bundled Caddy', () => {
  const ctx = useStack({ dedicated: true, proxy: true, setup: true })
  let repo: Repo
  let stream: LiveStream | undefined

  beforeAll(async () => {
    repo = await Repo.create()
  })
  afterAll(async () => {
    stream?.close()
    await repo.destroy()
  })

  it(
    'events arrive as they happen, not in a burst, and the heartbeat passes',
    { timeout: 90_000 },
    async () => {
      const { stack, setup } = ctx
      const ws = setup.workspace.slug
      const proxy = stack.proxyUrl
      if (!proxy) throw new Error('the stack has no proxy')
      const project = await createProject(setup.session, ws, 'Proxied')
      await repo.writeShots({ home: { dot: { x: 15, y: 15 } } })
      await repo.commit('proxied')
      const up = await uploadOrThrow({ stack, token: project.token, repo, wait: true })

      stream = await LiveStream.open(setup.session, { base: proxy })
      expect(stream.status).toBe(200)
      expect(stream.headers.get('content-type')).toContain('text/event-stream')
      // The server's `retry:` line is the first bytes of the stream: it came through before any event.
      await expect.poll(() => stream?.raw, { timeout: 2_000 }).toContain('retry:')

      // One quick change made straight at the app (not through the proxy): the event reaches the
      // client behind the proxy within a second of the change being answered.
      await approveBuild(setup.session, ws, project.slug, up.build.number)
      const answered = performance.now()
      const event = await stream.waitFor((e) => e.type === 'review.changed', 5_000)
      expect(event.at - answered).toBeLessThan(1_000)

      // A second change a moment later also arrives on its own, not batched with a later one.
      const before = stream.events.length
      await setup.session.post(
        `/api/projects/${ws}/${project.slug}/builds/${up.build.number}/review`,
        { state: 'rejected', reason: 'again' },
      )
      const second = performance.now()
      await expect.poll(() => stream!.events.length, { timeout: 2_000 }).toBeGreaterThan(before)
      expect(stream.events[before]!.at - second).toBeLessThan(1_000)

      // The 25 s heartbeat (a comment line) is passed along too, and the stream is still open.
      await expect
        .poll(() => stream!.comments.length, { timeout: 40_000, interval: 500 })
        .toBeGreaterThan(0)
      expect(stream.ended).toBe(false)
    },
  )
})
