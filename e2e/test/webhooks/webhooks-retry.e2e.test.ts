import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createProject, type CreatedProject } from '#clients/admin.ts'
import { uploadOrThrow } from '#clients/upload.ts'
import { disableWebhooks, failures, gapsOf, hookJobs } from '#clients/webhook-jobs.ts'
import { listen } from '#fakes/http.ts'
import { startWebhookReceiver } from '#fakes/webhook-receiver.ts'
import { Repo } from '#github/git-repo.ts'
import { useStack } from '#stack/vitest.ts'

/**
 * Webhook retries on the real stack, on a clock scaled down: this stack's worker waits 0.5 s
 * before the second attempt (production: 2 s) and doubles from there, and gives a receiver 2 s to
 * answer (production: 10 s). The schedule's shape is what is proved here (0.5, 1, 2 s: each wait
 * twice the one before, one delivery id throughout); the production numbers are pinned by the
 * unit tests of `retryDelayMs` and `loadConfig`. Dedicated stack: the other webhook tests
 * (webhooks.browser.e2e.test.ts) must see the real schedule, and these retry quickly.
 */
const BASE_MS = 500

describe('webhook retries (scaled clock: 0.5 s base, 2 s receiver timeout)', () => {
  const ctx = useStack({
    dedicated: true,
    setup: true,
    env: {
      JOB_RETRY_BASE_SECONDS: String(BASE_MS / 1000),
      WEBHOOK_TIMEOUT_SECONDS: '2',
    },
  })
  let repo: Repo
  let project: CreatedProject
  const closers: (() => Promise<void>)[] = []
  let n = 0

  beforeAll(async () => {
    repo = await Repo.create()
    project = await createProject(ctx.setup.session, ctx.setup.workspace.slug, 'Retries')
  })
  afterAll(async () => {
    await Promise.all(closers.map((close) => close()))
    await repo.destroy()
  })

  const apiAdd = (url: string) =>
    ctx.setup.session.post<{ webhook: { id: string }; secret: string }>(
      `/api/projects/${ctx.setup.workspace.slug}/${project.slug}/webhooks`,
      { url, events: ['build.completed'] },
    )
  /** A new build on main: one `build.completed` event for every enabled webhook. */
  const newBuild = async () => {
    n += 1
    await repo.writeShots({ home: { dot: { x: 10 * n, y: 10 * n } } })
    await repo.commit(`main ${n}`)
    await uploadOrThrow({ stack: ctx.stack, token: project.token, repo, wait: true })
  }

  it('a failing receiver is retried with exponential backoff and the same delivery id, until it recovers', async () => {
    const { stack } = ctx
    const flaky = await startWebhookReceiver()
    closers.push(() => flaky.close())
    const created = await apiAdd(`${flaky.url}/retry`)
    flaky.setSecret(created.secret)
    flaky.failWith(500, 2)

    await newBuild()

    // Two failures, then the third attempt is accepted: one delivery id, the same signed body.
    await expect.poll(() => flaky.deliveries.length, { timeout: 30_000 }).toBe(3)
    expect(flaky.deliveries.map((d) => d.respondedWith)).toEqual([500, 500, 200])
    expect(new Set(flaky.deliveries.map((d) => d.deliveryId)).size).toBe(1)
    expect(flaky.deliveries.every((d) => d.signatureValid)).toBe(true)
    expect(new Set(flaky.deliveries.map((d) => d.rawBody)).size).toBe(1)
    // Backoff 0.5 s, then 1 s (a wait is never shorter than scheduled; some slack for the first).
    const [g1 = 0, g2 = 0] = gapsOf(flaky)
    expect(g1).toBeGreaterThanOrEqual(BASE_MS * 0.8)
    expect(g2).toBeGreaterThanOrEqual(BASE_MS * 2 * 0.8)
    expect(g2).toBeGreaterThan(g1)
    // And not much later: the worker that failed the delivery wakes for it when the backoff is
    // over. Waiting for the 5 s poll instead would put both gaps past 4 s.
    expect(g1).toBeLessThan(3_000)
    expect(g2).toBeLessThan(4_000)
    await expect
      .poll(async () => (await hookJobs(stack, created.webhook.id))[0])
      .toMatchObject({ status: 'done', attempts: 3, error: '' })
    expect(await failures(stack, created.webhook.id)).toHaveLength(2)
    await disableWebhooks(stack, created.webhook.id)
  })

  it('gives up after 8 attempts (backoff doubling) and keeps the last error', async () => {
    const { stack } = ctx
    const down = await startWebhookReceiver()
    closers.push(() => down.close())
    const created = await apiAdd(`${down.url}/down`)
    down.setSecret(created.secret)
    down.failWith(503)
    const id = created.webhook.id

    await newBuild()

    // The first attempts run on the scaled schedule (0.5 s, 1 s, 2 s) ...
    await expect.poll(() => down.deliveries.length, { timeout: 30_000 }).toBeGreaterThanOrEqual(4)
    const [g1 = 0, g2 = 0, g3 = 0] = gapsOf(down)
    expect(g1).toBeGreaterThanOrEqual(BASE_MS * 0.8)
    expect(g2).toBeGreaterThanOrEqual(BASE_MS * 2 * 0.8)
    expect(g3).toBeGreaterThanOrEqual(BASE_MS * 4 * 0.8)
    // ... then the clock is wound forward past the longer waits (up to 32 s here).
    await expect
      .poll(
        async () => {
          await stack.jobs.runNow('webhook', { webhookId: id })
          return (await hookJobs(stack, id))[0]?.status
        },
        { timeout: 60_000, interval: 250 },
      )
      .toBe('failed')
    const [final] = await hookJobs(stack, id)
    expect(final).toMatchObject({ status: 'failed', attempts: 8 })
    expect(final?.error).toContain('answered 503')
    expect(down.deliveries).toHaveLength(8)
    expect(new Set(down.deliveries.map((d) => d.deliveryId)).size).toBe(1)
    expect(await stack.logs('circi')).toContain('webhook delivery failed for good')

    // Given up means given up: a recovered receiver is not called for the abandoned delivery.
    // Barrier instead of a sleep: the receiver recovers and a later event is sent to it. Once
    // that one has arrived, the worker has certainly had its chance to retry the old delivery.
    down.succeed()
    const abandoned = down.deliveries[0]?.deliveryId
    await newBuild()
    await expect.poll(() => down.deliveries.length, { timeout: 30_000 }).toBeGreaterThan(8)
    expect(down.deliveries.filter((d) => d.deliveryId === abandoned)).toHaveLength(8)
    expect(down.deliveries.at(-1)?.respondedWith).toBe(200)
    await disableWebhooks(stack, id)
  })

  it('a refused connection and a receiver that never answers are retried too', async () => {
    const { stack } = ctx
    // Connection refused: a port that was listening a moment ago.
    const gone = await listen((_req, res) => res.end())
    const gonePort = gone.port
    await gone.close()
    const refused = await apiAdd(`http://host.docker.internal:${gonePort}/gone`)
    // Never answers: the connection stays open until the 2 s timeout of this stack.
    let hits = 0
    const silent = await listen(() => {
      hits += 1
    })
    closers.push(() => silent.close())
    const slow = await apiAdd(`http://host.docker.internal:${silent.port}/slow`)

    await newBuild()

    await expect
      .poll(async () => (await failures(stack, refused.webhook.id))[0], { timeout: 30_000 })
      .toMatch(/fetch failed|ECONNREFUSED/)
    await expect
      .poll(async () => (await failures(stack, slow.webhook.id))[0], { timeout: 30_000 })
      .toMatch(/timeout|aborted/i)
    expect(hits).toBeGreaterThanOrEqual(1)
    // Both are still waiting for another attempt, not abandoned after one.
    expect((await hookJobs(stack, refused.webhook.id))[0]).toMatchObject({
      status: 'pending',
      attempts: expect.any(Number),
    })
    await disableWebhooks(stack, refused.webhook.id, slow.webhook.id)
  })
})
