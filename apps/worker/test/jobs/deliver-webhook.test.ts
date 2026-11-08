import { verifyWebhookSignature } from '@circi/core'
import { claimJob, createWebhook, enqueueJob, QUEUES, type Job } from '@circi/db'
import { seedProject } from '@circi/testing'
import { createTestDb, type TestDb } from '@circi/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { deliverWebhook } from '../../src/jobs/deliver-webhook.ts'

let t: TestDb

beforeAll(async () => {
  t = await createTestDb()
})
afterAll(async () => {
  await t.close()
})

async function jobFor(webhookId: string): Promise<Job> {
  await enqueueJob(t.db, {
    queue: QUEUES.webhook,
    payload: {
      webhookId,
      deliveryId: 'd-1',
      event: 'build.completed',
      createdAt: '2026-01-01T00:00:00.000Z',
      data: {
        organization: { slug: 'acme' },
        project: { slug: 'web' },
        build: { number: 7 },
      },
    },
  })
  const job = await claimJob(t.db, QUEUES.webhook, 60)
  if (!job) throw new Error('no job')
  return job
}

const answer =
  (status: number): typeof fetch =>
  async () =>
    new Response('', { status })

const publicDns = async () => ['93.184.216.34']

describe('deliverWebhook', () => {
  it('posts the signed body, with a link to the build', async () => {
    const { project } = await seedProject(t.db)
    const hook = await createWebhook(t.db, {
      projectId: project.id,
      url: 'https://hooks.acme.io/x',
      events: ['build.completed'],
    })
    const seen: { url: string; headers: Headers; body: string; redirect: string }[] = []
    const fetcher: typeof fetch = async (url, init) => {
      const req = new Request(url, init)
      seen.push({
        url: req.url,
        headers: req.headers,
        body: await req.text(),
        redirect: req.redirect,
      })
      return new Response('ok', { status: 200 })
    }

    const result = await deliverWebhook(
      { db: t.db, publicOrigin: 'https://ci.acme.io', fetch: fetcher, resolve: publicDns },
      await jobFor(hook.id),
    )
    expect(result).toEqual({ status: 'delivered', code: 200 })
    const [call] = seen
    const headers = call?.headers ?? new Headers()
    const body = call?.body ?? ''
    expect(call?.url).toBe('https://hooks.acme.io/x')
    expect(call?.redirect).toBe('manual')
    expect(headers.get('circi-event')).toBe('build.completed')
    expect(verifyWebhookSignature(hook.secret, body, headers.get('circi-signature') ?? '')).toBe(
      true,
    )
    expect(JSON.parse(body)).toMatchObject({
      id: 'd-1',
      event: 'build.completed',
      url: 'https://ci.acme.io/acme/web/builds/7',
    })
  })

  it('throws on a non-2xx answer (so the queue retries) and on a redirect', async () => {
    const { project } = await seedProject(t.db)
    const hook = await createWebhook(t.db, {
      projectId: project.id,
      url: 'https://hooks.acme.io/x',
      events: ['build.completed'],
    })
    await expect(
      deliverWebhook({ db: t.db, fetch: answer(500), resolve: publicDns }, await jobFor(hook.id)),
    ).rejects.toThrow('500')
    await expect(
      deliverWebhook({ db: t.db, fetch: answer(302), resolve: publicDns }, await jobFor(hook.id)),
    ).rejects.toThrow('302')
  })

  it('skips a webhook that was deleted', async () => {
    const result = await deliverWebhook(
      { db: t.db },
      await jobFor('00000000-0000-0000-0000-000000000000'),
    )
    expect(result).toEqual({ status: 'skipped', reason: 'webhook was deleted' })
  })

  it('skips a receiver whose name now points at a private address', async () => {
    const { project } = await seedProject(t.db)
    const hook = await createWebhook(t.db, {
      projectId: project.id,
      url: 'https://hooks.acme.io/x',
      events: ['build.completed'],
    })
    const result = await deliverWebhook(
      { db: t.db, fetch: answer(200), resolve: async () => ['169.254.169.254'] },
      await jobFor(hook.id),
    )
    expect(result).toMatchObject({ status: 'skipped' })
    const allowed = await deliverWebhook(
      { db: t.db, fetch: answer(200), resolve: async () => ['10.0.0.9'], allowPrivate: true },
      await jobFor(hook.id),
    )
    expect(allowed).toEqual({ status: 'delivered', code: 200 })
  })
})
