import { createDecipheriv, createECDH, hkdfSync, randomBytes } from 'node:crypto'

import { generateVapidKeys } from '@circi/core/node'
import { type Job } from '@circi/db'
import { QUEUES } from '@circi/db/queue'
import {
  createBuild,
  listPushSubscriptions,
  savePushSubscription,
  setNotificationPreferences,
} from '@circi/db/repositories'
import * as schema from '@circi/db/schema'
import { addTestMember, createTestDb, seedProject, seedUser } from '@circi/db/testing'
import { fakeMailer } from '@circi/testing'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  deliverNotification,
  deliverPush,
  getVapidKeys,
  notify,
  removePushDevice,
  subscribePush,
  unsubscribePush,
} from '#src/index.ts'

let t: createTestDb.Result
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(async () => {
  await t.close()
})

const SECRET = 'a-test-secret-of-at-least-32-characters'
const publicIp = async () => ['203.0.113.7']

/** A browser's push subscription: the endpoint, and the keys it keeps to read what arrives. */
function browser(endpoint: string) {
  const ecdh = createECDH('prime256v1')
  ecdh.generateKeys()
  const auth = randomBytes(16)
  return {
    endpoint,
    ecdh,
    auth,
    p256dh: ecdh.getPublicKey().toString('base64url'),
    authB64: auth.toString('base64url'),
  }
}

/** What a browser does with a push body (RFC 8291), to check what was sent. */
function open(body: Buffer, b: ReturnType<typeof browser>): unknown {
  const salt = body.subarray(0, 16)
  const asPublic = body.subarray(21, 21 + (body[20] ?? 0))
  const record = body.subarray(21 + asPublic.length)
  const info = Buffer.concat([Buffer.from('WebPush: info\0'), b.ecdh.getPublicKey(), asPublic])
  const ikm = Buffer.from(hkdfSync('sha256', b.ecdh.computeSecret(asPublic), b.auth, info, 32))
  const cek = Buffer.from(hkdfSync('sha256', ikm, salt, 'Content-Encoding: aes128gcm\0', 16))
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, 'Content-Encoding: nonce\0', 12))
  const d = createDecipheriv('aes-128-gcm', cek, nonce)
  d.setAuthTag(record.subarray(record.length - 16))
  const plain = Buffer.concat([d.update(record.subarray(0, record.length - 16)), d.final()])
  return JSON.parse(plain.subarray(0, plain.lastIndexOf(2)).toString())
}

/** The push service, faked at its edge: records requests and answers with the given status. */
function fakePushService(statusFor: (endpoint: string) => number = () => 201) {
  const requests: { url: string; headers: Headers; body: Buffer }[] = []
  const fetchFake: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : ''
    requests.push({
      url,
      headers: new Headers(init?.headers),
      body: init?.body instanceof Uint8Array ? Buffer.from(init.body) : Buffer.alloc(0),
    })
    return new Response(null, { status: statusFor(url) })
  }
  return { requests, fetch: fetchFake }
}

const jobFor = (notificationId: string): Job => ({
  id: 1,
  queue: QUEUES.notificationEmail,
  payload: { notificationId },
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

async function setup() {
  const { project, workspace, owner } = await seedProject(t.db)
  const reviewer = await seedUser(t.db)
  await addTestMember(t.db, { workspaceId: workspace.id, userId: reviewer.id })
  const build = await createBuild(t.db, {
    projectId: project.id,
    commitSha: 'abc1234',
    branch: 'feat',
  })
  return { project, workspace, owner, reviewer, build }
}

async function subscribed(userId: string, endpoint: string) {
  const b = browser(endpoint)
  await subscribePush(t.db, { userId, endpoint, p256dh: b.p256dh, auth: b.authB64 })
  return b
}

const jobsFor = (notificationId: string) =>
  t.db
    .select()
    .from(schema.jobs)
    .where(eq(schema.jobs.dedupeKey, `notification-email:${notificationId}`))

describe('queueing a push', () => {
  it('queues the delivery job for a person with a device and the kind turned on', async () => {
    const { owner, reviewer, build } = await setup()
    await subscribed(reviewer.id, 'https://push.example.com/a')
    const n = await notify(t.db, {
      userId: reviewer.id,
      kind: 'mentioned',
      buildId: build.id,
      actorId: owner.id,
    })
    // A mention is never emailed: the job exists for the push alone.
    expect(await jobsFor(n?.id ?? '')).toHaveLength(1)
  })

  it('queues nothing without a device, with the kind turned off, or for a kind that is not pushed', async () => {
    const { owner, reviewer, build } = await setup()
    const none = await notify(t.db, { userId: reviewer.id, kind: 'mentioned', actorId: owner.id })
    expect(await jobsFor(none?.id ?? '')).toHaveLength(0)

    await subscribed(reviewer.id, 'https://push.example.com/b')
    await setNotificationPreferences(t.db, reviewer.id, { pushMentioned: false })
    const off = await notify(t.db, {
      userId: reviewer.id,
      kind: 'mentioned',
      buildId: build.id,
      actorId: owner.id,
    })
    expect(await jobsFor(off?.id ?? '')).toHaveLength(0)

    const flaky = await notify(t.db, { userId: reviewer.id, kind: 'flaky_detected' })
    expect(await jobsFor(flaky?.id ?? '')).toHaveLength(0)
  })
})

describe('deliverPush', () => {
  it('sends the title, body and path, encrypted for the device, signed with the instance key', async () => {
    const { owner, reviewer, build, project, workspace } = await setup()
    const b = await subscribed(reviewer.id, 'https://push.example.com/send')
    const n = await notify(t.db, {
      userId: reviewer.id,
      kind: 'build_rejected',
      buildId: build.id,
      actorId: owner.id,
      payload: { reason: 'Spacing off on mobile' },
    })
    const service = fakePushService()
    const result = await deliverPush(
      {
        db: t.db,
        authSecret: SECRET,
        subject: 'mailto:ops@ci.acme.io',
        fetch: service.fetch,
        resolve: publicIp,
      },
      n?.id ?? '',
    )
    expect(result).toEqual({ status: 'done', sent: 1, removed: 0, failed: 0 })
    const [request] = service.requests
    expect(request?.url).toBe('https://push.example.com/send')
    expect(request?.headers.get('content-encoding')).toBe('aes128gcm')
    const keys = await getVapidKeys(t.db, { authSecret: SECRET })
    expect(request?.headers.get('authorization')).toMatch(
      new RegExp(`^vapid t=[\\w-]+\\.[\\w-]+\\.[\\w-]+, k=${keys.publicKey}$`),
    )
    expect(open(request?.body ?? Buffer.alloc(0), b)).toEqual({
      title: 'Rejected',
      body: `${owner.name} rejected #${build.number} (feat), ${project.name}: Spacing off on mobile`,
      url: `/${workspace.slug}/${project.slug}/builds/${build.number}`,
      tag: n?.id,
      project: project.name,
    })
    const [row] = await listPushSubscriptions(t.db, reviewer.id)
    expect(row?.lastUsedAt).toBeInstanceOf(Date)
  })

  it('removes a device the push service says is gone (404 or 410), keeps one that merely failed', async () => {
    const { owner, reviewer, build } = await setup()
    await subscribed(reviewer.id, 'https://push.example.com/ok')
    await subscribed(reviewer.id, 'https://push.example.com/gone')
    await subscribed(reviewer.id, 'https://push.example.com/old')
    await subscribed(reviewer.id, 'https://push.example.com/down')
    const n = await notify(t.db, {
      userId: reviewer.id,
      kind: 'mentioned',
      buildId: build.id,
      actorId: owner.id,
    })
    const service = fakePushService((url) =>
      url.endsWith('/gone') ? 410 : url.endsWith('/old') ? 404 : url.endsWith('/down') ? 503 : 201,
    )
    const result = await deliverPush(
      {
        db: t.db,
        authSecret: SECRET,
        subject: 'mailto:a@b.c',
        fetch: service.fetch,
        resolve: publicIp,
      },
      n?.id ?? '',
    )
    expect(result).toEqual({ status: 'done', sent: 1, removed: 2, failed: 1 })
    const left = (await listPushSubscriptions(t.db, reviewer.id)).map((s) => s.endpoint)
    expect(left.toSorted()).toEqual([
      'https://push.example.com/down',
      'https://push.example.com/ok',
    ])
  })

  it('respects the per-kind preference, a read notification and a missing notification', async () => {
    const { owner, reviewer, build } = await setup()
    await subscribed(reviewer.id, 'https://push.example.com/p')
    const service = fakePushService()
    const deps = {
      db: t.db,
      authSecret: SECRET,
      subject: 'mailto:a@b.c',
      fetch: service.fetch,
      resolve: publicIp,
    }
    const approved = await notify(t.db, {
      userId: reviewer.id,
      kind: 'build_approved',
      buildId: build.id,
      actorId: owner.id,
    })
    await setNotificationPreferences(t.db, reviewer.id, { pushReviewOutcome: false })
    expect(await deliverPush(deps, approved?.id ?? '')).toEqual({
      status: 'skipped',
      reason: 'opted out',
    })
    await setNotificationPreferences(t.db, reviewer.id, { pushReviewOutcome: true })
    await t.db
      .update(schema.notifications)
      .set({ readAt: new Date() })
      .where(eq(schema.notifications.id, approved?.id ?? ''))
    expect(await deliverPush(deps, approved?.id ?? '')).toMatchObject({
      reason: 'already handled in the inbox',
    })
    expect(await deliverPush(deps, '00000000-0000-4000-8000-000000000000')).toMatchObject({
      reason: 'notification was deleted',
    })
    expect(service.requests).toHaveLength(0)
  })

  it('never calls a push address that resolves to a private network', async () => {
    const { owner, reviewer, build } = await setup()
    await subscribed(reviewer.id, 'https://push.example.com/rebind')
    const n = await notify(t.db, {
      userId: reviewer.id,
      kind: 'mentioned',
      buildId: build.id,
      actorId: owner.id,
    })
    const service = fakePushService()
    const result = await deliverPush(
      {
        db: t.db,
        authSecret: SECRET,
        subject: 'mailto:a@b.c',
        fetch: service.fetch,
        resolve: async () => ['10.0.0.5'],
      },
      n?.id ?? '',
    )
    expect(result).toEqual({ status: 'done', sent: 0, removed: 0, failed: 1 })
    expect(service.requests).toHaveLength(0)
  })
})

describe('deliverNotification (the job)', () => {
  it('sends the email and the push for one notification, and the push alone when email is off', async () => {
    const { owner, reviewer, build } = await setup()
    await subscribed(reviewer.id, 'https://push.example.com/both')
    const n = await notify(t.db, {
      userId: reviewer.id,
      kind: 'review_requested',
      buildId: build.id,
      actorId: owner.id,
    })
    const mailer = fakeMailer()
    const service = fakePushService()
    const deps = {
      db: t.db,
      mailer,
      publicOrigin: 'https://ci.acme.io',
      push: {
        authSecret: SECRET,
        subject: 'mailto:a@b.c',
        fetch: service.fetch,
        resolve: publicIp,
      },
    }
    const both = await deliverNotification(deps, jobFor(n?.id ?? ''))
    expect(both.email).toEqual({ status: 'sent' })
    expect(both.push).toMatchObject({ status: 'done', sent: 1 })
    expect(mailer.sent).toHaveLength(1)

    await setNotificationPreferences(t.db, reviewer.id, { emailReviewRequested: false })
    const pushOnly = await deliverNotification(deps, jobFor(n?.id ?? ''))
    expect(pushOnly.email).toMatchObject({ status: 'skipped', reason: 'opted out' })
    expect(pushOnly.push).toMatchObject({ status: 'done', sent: 1 })
    expect(mailer.sent).toHaveLength(1)
  })

  it('only does the email when the worker has no push settings', async () => {
    const { owner, reviewer, build } = await setup()
    await subscribed(reviewer.id, 'https://push.example.com/none')
    const n = await notify(t.db, {
      userId: reviewer.id,
      kind: 'review_requested',
      buildId: build.id,
      actorId: owner.id,
    })
    const result = await deliverNotification(
      { db: t.db, mailer: fakeMailer() },
      jobFor(n?.id ?? ''),
    )
    expect(result.push).toEqual({ status: 'skipped', reason: 'push is not set up in this worker' })
  })
})

describe('devices', () => {
  it('names a device from its browser, refuses a private or non-https address and bad keys', async () => {
    const user = await seedUser(t.db)
    const b = browser('https://push.example.com/dev')
    const row = await subscribePush(t.db, {
      userId: user.id,
      endpoint: b.endpoint,
      p256dh: b.p256dh,
      auth: b.authB64,
      userAgent:
        'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36',
    })
    expect(row.label).toBe('Chrome on Android')
    const base = { userId: user.id, p256dh: b.p256dh, auth: b.authB64 }
    await expect(subscribePush(t.db, { ...base, endpoint: 'https://127.0.0.1/x' })).rejects.toThrow(
      'not valid',
    )
    await expect(
      subscribePush(t.db, { ...base, endpoint: 'http://push.example.com/x' }),
    ).rejects.toThrow('not valid')
    await expect(
      subscribePush(t.db, { ...base, endpoint: 'https://push.example.com/y', p256dh: 'AAAA' }),
    ).rejects.toThrow('key')
  })

  it('turns a device off by endpoint, and removes only your own by ID', async () => {
    const ann = await seedUser(t.db)
    const bob = await seedUser(t.db)
    await subscribed(ann.id, 'https://push.example.com/ann1')
    const second = await subscribed(ann.id, 'https://push.example.com/ann2')
    await unsubscribePush(t.db, { userId: ann.id, endpoint: 'https://push.example.com/ann1' })
    const [left] = await listPushSubscriptions(t.db, ann.id)
    expect(left?.endpoint).toBe(second.endpoint)
    await expect(removePushDevice(t.db, { userId: bob.id, id: left?.id ?? '' })).rejects.toThrow(
      'not found',
    )
    await removePushDevice(t.db, { userId: ann.id, id: left?.id ?? '' })
    expect(await listPushSubscriptions(t.db, ann.id)).toEqual([])
  })
})

describe('getVapidKeys', () => {
  it('makes a pair once, keeps it across calls, and stores the private half sealed', async () => {
    const db = (await createTestDb()).db
    const a = await getVapidKeys(db, { authSecret: SECRET })
    const b = await getVapidKeys(db, { authSecret: SECRET })
    expect(b).toEqual(a)
    const [row] = await db
      .select()
      .from(schema.instanceSettings)
      .where(eq(schema.instanceSettings.key, 'vapid_keys'))
    expect(row?.value).not.toContain(a.privateKey)
  })

  it('uses the keys from the environment as they are, and stores nothing', async () => {
    const own = generateVapidKeys()
    const own2 = await createTestDb()
    expect(await getVapidKeys(own2.db, { authSecret: SECRET, fromEnv: own })).toEqual(own)
    expect(await own2.db.select().from(schema.instanceSettings)).toEqual([])
    await own2.close()
  })

  it('starts over, dropping every subscription, when the instance secret has changed', async () => {
    const fresh = await createTestDb()
    const { db } = fresh
    const user = await seedUser(db)
    const first = await getVapidKeys(db, { authSecret: SECRET })
    await savePushSubscription(db, {
      userId: user.id,
      endpoint: 'https://push.example.com/old-keys',
      p256dh: 'x',
      auth: 'y',
      label: 'Chrome',
    })
    const second = await getVapidKeys(db, { authSecret: 'another-secret-of-at-least-32-chars!' })
    expect(second.publicKey).not.toBe(first.publicKey)
    expect(await listPushSubscriptions(db, user.id)).toEqual([])
    await fresh.close()
  })
})
