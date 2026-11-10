import { listPushDevices } from '@circi/db/queries'
import {
  deleteAllPushSubscriptions,
  deletePushSubscription,
  deletePushSubscriptionByEndpoint,
  deletePushSubscriptionsById,
  hasPushSubscription,
  listPushSubscriptions,
  pushPreferenceFor,
  savePushSubscription,
  setNotificationPreferences,
  setSettingIfAbsent,
  touchPushSubscriptions,
} from '@circi/db/repositories'
import { createTestDb, seedUser } from '@circi/db/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

let t: createTestDb.Result
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(async () => {
  await t.close()
})

const sub = (userId: string, endpoint: string, label = 'Chrome') => ({
  userId,
  endpoint,
  p256dh: 'p',
  auth: 'a',
  userAgent: 'UA',
  label,
})

describe('push subscriptions', () => {
  it('keeps one row per endpoint: saving it again updates the owner, keys and label', async () => {
    const ann = await seedUser(t.db)
    const bob = await seedUser(t.db)
    const first = await savePushSubscription(t.db, sub(ann.id, 'https://push.example/1'))
    const again = await savePushSubscription(t.db, {
      ...sub(bob.id, 'https://push.example/1', 'Firefox'),
      p256dh: 'p2',
    })
    expect(again.id).toBe(first.id)
    expect(again).toMatchObject({ userId: bob.id, label: 'Firefox', p256dh: 'p2' })
    expect(await listPushSubscriptions(t.db, ann.id)).toEqual([])
    expect(await hasPushSubscription(t.db, ann.id)).toBe(false)
    expect(await hasPushSubscription(t.db, bob.id)).toBe(true)
  })

  it("lists a person's devices without keys, oldest first, and records use", async () => {
    const ann = await seedUser(t.db)
    const a = await savePushSubscription(t.db, sub(ann.id, 'https://push.example/a', 'Pixel 8'))
    const b = await savePushSubscription(t.db, sub(ann.id, 'https://push.example/b', 'Mac'))
    await touchPushSubscriptions(t.db, [b.id])
    const devices = await listPushDevices(t.db, ann.id)
    expect(devices.map((d) => d.label)).toEqual(['Pixel 8', 'Mac'])
    expect(devices[0]?.lastUsedAt).toBeNull()
    expect(devices[1]?.lastUsedAt).toBeInstanceOf(Date)
    expect(Object.keys(devices[0] ?? {})).not.toContain('auth')
    expect(devices[0]?.id).toBe(a.id)
  })

  it('removes only the own device, by ID or endpoint, and dead ones by ID', async () => {
    const ann = await seedUser(t.db)
    const bob = await seedUser(t.db)
    const a = await savePushSubscription(t.db, sub(ann.id, 'https://push.example/r1'))
    const b = await savePushSubscription(t.db, sub(ann.id, 'https://push.example/r2'))
    const c = await savePushSubscription(t.db, sub(ann.id, 'https://push.example/r3'))
    expect(await deletePushSubscription(t.db, { userId: bob.id, id: a.id })).toBe(false)
    expect(await deletePushSubscription(t.db, { userId: ann.id, id: a.id })).toBe(true)
    expect(
      await deletePushSubscriptionByEndpoint(t.db, { userId: bob.id, endpoint: b.endpoint }),
    ).toBe(false)
    expect(
      await deletePushSubscriptionByEndpoint(t.db, { userId: ann.id, endpoint: b.endpoint }),
    ).toBe(true)
    await deletePushSubscriptionsById(t.db, [c.id])
    expect(await listPushSubscriptions(t.db, ann.id)).toEqual([])
  })

  it('drops every subscription when the keys they were made under are gone', async () => {
    const ann = await seedUser(t.db)
    await savePushSubscription(t.db, sub(ann.id, 'https://push.example/z'))
    await deleteAllPushSubscriptions(t.db)
    expect(await hasPushSubscription(t.db, ann.id)).toBe(false)
  })
})

describe('push preferences and settings', () => {
  it('defaults every push kind on, changes one, and maps kinds to their switch', async () => {
    const ann = await seedUser(t.db)
    const saved = await setNotificationPreferences(t.db, ann.id, { pushMentioned: false })
    expect(saved).toMatchObject({
      pushMentioned: false,
      pushReviewRequested: true,
      pushReviewOutcome: true,
    })
    expect(pushPreferenceFor('review_overdue')).toBe('pushReviewRequested')
    expect(pushPreferenceFor('mentioned')).toBe('pushMentioned')
    expect(pushPreferenceFor('build_rejected')).toBe('pushReviewOutcome')
    expect(pushPreferenceFor('flaky_detected')).toBeUndefined()
  })

  it('stores an instance setting only when none exists', async () => {
    expect(await setSettingIfAbsent(t.db, 'test_key', 'one')).toBe(true)
    expect(await setSettingIfAbsent(t.db, 'test_key', 'two')).toBe(false)
  })
})
