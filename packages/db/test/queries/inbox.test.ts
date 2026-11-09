import {
  addTestMember,
  createTestDb,
  seedBuild,
  seedNotification,
  seedTeam,
  seedReviewRequest,
  seedUser,
} from '@circi/db/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { countUnreadNotifications, listInbox } from '#src/queries/index.ts'

let t: createTestDb.Result
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(async () => {
  await t.close()
})

const now = new Date('2026-03-10T12:00:00.000Z')
const later = new Date('2026-03-11T09:00:00.000Z')
const before = new Date('2026-03-09T09:00:00.000Z')

async function setup() {
  const { team, workspace, owner } = await seedTeam(t.db)
  const teammate = await seedUser(t.db)
  await addTestMember(t.db, { workspaceId: workspace.id, userId: teammate.id })
  const build = await seedBuild(t.db, team.id, { branch: 'feature/x', prNumber: 7 })
  return { team, workspace, owner, teammate, build }
}
const tab = (userId: string, name: 'for-you' | 'everything' | 'snoozed') =>
  listInbox(t.db, { userId, tab: name, now })

describe('listInbox', () => {
  it('shows a notification with its build, team and actor, newest first', async () => {
    const { team, workspace, owner, teammate, build } = await setup()
    await seedNotification(t.db, { userId: owner.id, createdAt: before })
    const newer = await seedNotification(t.db, {
      userId: owner.id,
      kind: 'build_rejected',
      buildId: build.id,
      actorId: teammate.id,
      payload: { reason: 'clipped' },
      createdAt: now,
    })
    const { items, unread } = await tab(owner.id, 'for-you')
    expect(unread).toBe(2)
    expect(items[0]).toMatchObject({
      id: newer.id,
      kind: 'build_rejected',
      payload: { reason: 'clipped' },
      actor: { id: teammate.id, name: teammate.name },
      build: { number: build.number, branch: 'feature/x', prNumber: 7 },
      team: { slug: team.slug },
      workspace: { slug: workspace.slug },
      alsoInReviews: false,
    })
    expect(items).toHaveLength(2)
  })

  it('tags a notification whose build also waits in Reviews', async () => {
    const { owner, teammate, build } = await setup()
    await seedReviewRequest(t.db, {
      buildId: build.id,
      reviewerId: owner.id,
      requestedById: teammate.id,
    })
    await seedNotification(t.db, { userId: owner.id, buildId: build.id })
    expect((await tab(owner.id, 'for-you')).items[0]?.alsoInReviews).toBe(true)
  })

  it('keeps team-wide notices to Everything', async () => {
    const { owner } = await setup()
    await seedNotification(t.db, { userId: owner.id, kind: 'flaky_detected' })
    expect((await tab(owner.id, 'for-you')).items).toEqual([])
    expect((await tab(owner.id, 'everything')).items).toHaveLength(1)
  })

  it('hides snoozed notifications until they wake, and counts them only then', async () => {
    const { owner } = await setup()
    const asleep = await seedNotification(t.db, { userId: owner.id, snoozedUntil: later })
    const woke = await seedNotification(t.db, { userId: owner.id, snoozedUntil: before })
    const ids = async (name: 'for-you' | 'everything' | 'snoozed') =>
      (await tab(owner.id, name)).items.map((i) => i.id)
    expect(await ids('everything')).toEqual([woke.id])
    expect(await ids('snoozed')).toEqual([asleep.id])
    expect(await countUnreadNotifications(t.db, { userId: owner.id, now })).toBe(1)
    expect(
      await countUnreadNotifications(t.db, {
        userId: owner.id,
        now: new Date(later.getTime() + 1),
      }),
    ).toBe(2)
  })

  it('leaves out deleted notifications, and counts only unread ones', async () => {
    const { owner } = await setup()
    await seedNotification(t.db, { userId: owner.id, deletedAt: before })
    await seedNotification(t.db, { userId: owner.id, readAt: before })
    const { items, unread } = await tab(owner.id, 'everything')
    expect(items).toHaveLength(1)
    expect(unread).toBe(0)
  })

  it('shows a person only their own, and nothing from a workspace they left', async () => {
    const { team, owner, teammate, build } = await setup()
    await seedNotification(t.db, { userId: teammate.id })
    expect((await tab(owner.id, 'everything')).items).toEqual([])

    const outsider = await seedUser(t.db)
    await seedNotification(t.db, { userId: outsider.id, buildId: build.id })
    await seedNotification(t.db, { userId: outsider.id, kind: 'flaky_detected' })
    // Not a member of the build's workspace: the build-bound one is hidden.
    const seen = (await tab(outsider.id, 'everything')).items
    expect(seen.map((i) => i.kind)).toEqual(['flaky_detected'])
    expect(team.id).toBeDefined()
  })
})
