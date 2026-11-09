import { type Job } from '@circi/db'
import { listWebhookDeliveries } from '@circi/db/queries'
import { QUEUES } from '@circi/db/queue'
import { createBuild, setNotificationPreferences } from '@circi/db/repositories'
import { addTestMember, createTestDb, seedTeam, seedUser, seedWebhook } from '@circi/db/testing'
import { fakeMailer } from '@circi/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { deliverWebhook, notify, sendNotificationEmail } from '#src/index.ts'

let t: createTestDb.Result
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(async () => {
  await t.close()
})

const jobOf = (queue: string, payload: Job['payload']): Job => ({
  id: 1,
  queue,
  payload,
  dedupeKey: null,
  status: 'running',
  attempts: 1,
  maxAttempts: 5,
  runAt: new Date(),
  lockedUntil: null,
  lastError: null,
  createdAt: new Date(),
  finishedAt: null,
})

const payload = (webhookId: string) => ({
  webhookId,
  deliveryId: 'd-1',
  event: 'build.completed',
  createdAt: '2026-01-01T00:00:00.000Z',
  data: { workspace: { slug: 'acme' }, team: { slug: 'web' }, build: { number: 7 } },
})

describe('deliverWebhook (service)', () => {
  it('delivers, records the attempt, and throws on a non-2xx so the queue retries', async () => {
    const { team } = await seedTeam(t.db)
    const hook = await seedWebhook(t.db, team.id)
    const deps = { db: t.db, resolve: async () => ['93.184.216.34'] }
    const ok = await deliverWebhook(
      { ...deps, fetch: async () => new Response('', { status: 200 }) },
      jobOf(QUEUES.webhook, payload(hook.id)),
    )
    expect(ok).toEqual({ status: 'delivered', code: 200 })
    await expect(
      deliverWebhook(
        { ...deps, fetch: async () => new Response('', { status: 500 }) },
        jobOf(QUEUES.webhook, payload(hook.id)),
      ),
    ).rejects.toThrow(/answered 500/)
    expect(
      (await listWebhookDeliveries(t.db, [hook.id])).get(hook.id)?.length ?? 0,
    ).toBeGreaterThan(0)
  })

  it('refuses a receiver that resolves to a private address', async () => {
    const { team } = await seedTeam(t.db)
    const hook = await seedWebhook(t.db, team.id)
    let called = false
    const result = await deliverWebhook(
      {
        db: t.db,
        resolve: async () => ['10.0.0.5'],
        fetch: async () => {
          called = true
          return new Response('')
        },
      },
      jobOf(QUEUES.webhook, payload(hook.id)),
    )
    expect(result.status).toBe('skipped')
    expect(called).toBe(false)
  })
})

describe('sendNotificationEmail (service)', () => {
  it('mails once, and skips when the reviewer has opted out', async () => {
    const { team, workspace, owner } = await seedTeam(t.db)
    const reviewer = await seedUser(t.db)
    await addTestMember(t.db, { workspaceId: workspace.id, userId: reviewer.id })
    const build = await createBuild(t.db, { teamId: team.id, commitSha: 'abc1234', branch: 'f' })
    const n = await notify(t.db, {
      userId: reviewer.id,
      kind: 'review_requested',
      buildId: build.id,
      actorId: owner.id,
    })
    if (!n) throw new Error('no notification')
    const mailer = fakeMailer()
    const job = jobOf(QUEUES.notificationEmail, { notificationId: n.id })
    expect(
      await sendNotificationEmail({ db: t.db, mailer, publicOrigin: 'https://ci' }, job),
    ).toEqual({
      status: 'sent',
    })
    expect(mailer.sent).toHaveLength(1)
    await setNotificationPreferences(t.db, reviewer.id, { emailReviewRequested: false })
    expect(await sendNotificationEmail({ db: t.db, mailer }, job)).toEqual({
      status: 'skipped',
      reason: 'opted out',
    })
  })
})
