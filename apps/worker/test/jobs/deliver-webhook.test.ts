import { verifyWebhookSignature } from '@circi/core'
import { type Job } from '@circi/db'
import { listWebhookDeliveries } from '@circi/db/queries'
import { claimJob, createWebhook, enqueueJob, QUEUES, queueTestWebhook } from '@circi/db/queue'
import { seedTeam } from '@circi/testing'
import { createTestDb } from '@circi/testing'
import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { deliverWebhook } from '#jobs/deliver-webhook.ts'

let t: createTestDb.Result

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
        workspace: { slug: 'acme' },
        team: { slug: 'web' },
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

const refused: typeof fetch = async () => {
  throw new Error('connect ECONNREFUSED')
}

const publicDns = async () => ['93.184.216.34']

describe('deliverWebhook', () => {
  it('posts the signed body, with a link to the build', async () => {
    const { team } = await seedTeam(t.db)
    const hook = await createWebhook(t.db, {
      teamId: team.id,
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
    const { team } = await seedTeam(t.db)
    const hook = await createWebhook(t.db, {
      teamId: team.id,
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
    const { team } = await seedTeam(t.db)
    const hook = await createWebhook(t.db, {
      teamId: team.id,
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

  it('records every attempt: the status, the failure, and the attempt number', async () => {
    const { team } = await seedTeam(t.db)
    const hook = await createWebhook(t.db, {
      teamId: team.id,
      url: 'https://hooks.acme.io/x',
      events: ['build.completed'],
    })
    await expect(
      deliverWebhook({ db: t.db, fetch: refused, resolve: publicDns }, await jobFor(hook.id)),
    ).rejects.toThrow('ECONNREFUSED')
    await expect(
      deliverWebhook({ db: t.db, fetch: answer(500), resolve: publicDns }, await jobFor(hook.id)),
    ).rejects.toThrow('500')
    await deliverWebhook(
      { db: t.db, fetch: answer(202), resolve: publicDns },
      await jobFor(hook.id),
    )
    const list = (await listWebhookDeliveries(t.db, [hook.id])).get(hook.id) ?? []
    expect(list.map((d) => [d.statusCode, d.error, d.attempt, d.test])).toEqual([
      [202, null, 1, false],
      [500, null, 1, false],
      [null, 'connect ECONNREFUSED', 1, false],
    ])
  })

  it('delivers a queued test event, marked as a test with no build', async () => {
    const { team } = await seedTeam(t.db)
    const hook = await createWebhook(t.db, {
      teamId: team.id,
      url: 'https://hooks.acme.io/x',
      events: ['build.completed'],
    })
    const deliveryId = await queueTestWebhook(t.db, hook.id)
    const job = await claimJob(t.db, QUEUES.webhook, 60)
    if (!job) throw new Error('no job')
    let sent = { body: '', signature: '', event: '' }
    const fetcher: typeof fetch = async (url, init) => {
      const req = new Request(url, init)
      sent = {
        body: await req.text(),
        signature: req.headers.get('circi-signature') ?? '',
        event: req.headers.get('circi-event') ?? '',
      }
      return new Response('', { status: 200 })
    }
    const result = await deliverWebhook(
      { db: t.db, publicOrigin: 'https://ci.acme.io', fetch: fetcher, resolve: publicDns },
      job,
    )
    expect(result).toEqual({ status: 'delivered', code: 200 })
    expect(sent.event).toBe('webhook.test')
    expect(verifyWebhookSignature(hook.secret, sent.body, sent.signature)).toBe(true)
    const body = JSON.parse(sent.body)
    expect(body).toMatchObject({ id: deliveryId, event: 'webhook.test', test: true })
    expect(body.build).toBeUndefined()
    expect(body.url).toBeUndefined()
    const [row] = (await listWebhookDeliveries(t.db, [hook.id])).get(hook.id) ?? []
    expect(row).toMatchObject({ deliveryId, test: true, statusCode: 200 })
  })

  it('is not affected by a failing history insert: a delivered event stays delivered, a network error stays the error', async () => {
    const { team } = await seedTeam(t.db)
    const hook = await createWebhook(t.db, {
      teamId: team.id,
      url: 'https://hooks.acme.io/x',
      events: ['build.completed'],
    })
    await t.db.execute(sql`
      create function circi_test_no_history() returns trigger as $$
      begin raise exception 'history down'; end $$ language plpgsql`)
    await t.db.execute(sql`
      create trigger circi_test_no_history before insert on webhook_deliveries
      for each row execute function circi_test_no_history()`)
    const warned: string[] = []
    const warn = (_: object, msg: string) => void warned.push(msg)
    try {
      const ok = await deliverWebhook(
        { db: t.db, fetch: answer(200), resolve: publicDns, warn },
        await jobFor(hook.id),
      )
      expect(ok).toEqual({ status: 'delivered', code: 200 })
      await expect(
        deliverWebhook(
          { db: t.db, fetch: refused, resolve: publicDns, warn },
          await jobFor(hook.id),
        ),
      ).rejects.toThrow('ECONNREFUSED')
    } finally {
      await t.db.execute(sql`drop trigger circi_test_no_history on webhook_deliveries`)
      await t.db.execute(sql`drop function circi_test_no_history()`)
    }
    expect(warned).toEqual([
      'could not record the webhook delivery',
      'could not record the webhook delivery',
    ])
  })
})
