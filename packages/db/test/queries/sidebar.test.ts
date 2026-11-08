import {
  addTestMember,
  createTestDb,
  seedBuild,
  seedNotification,
  seedPinnedProject,
  seedProject,
  seedReviewRequest,
  seedSavedView,
  seedUser,
} from '@circi/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { getSidebar } from '#src/index.ts'

let t: createTestDb.Result
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(async () => {
  await t.close()
})

const now = new Date('2026-03-10T12:00:00.000Z')

describe('getSidebar', () => {
  it('orders pinned projects first then A to Z, with known counts', async () => {
    const first = await seedProject(t.db, { slug: 'mid' })
    const { org, owner } = first
    const zeta = await seedProject(t.db, { org: { org, owner }, slug: 'zeta' })
    const alpha = await seedProject(t.db, { org: { org, owner }, slug: 'alpha' })
    const mate = await seedUser(t.db)
    await addTestMember(t.db, { orgId: org.id, userId: mate.id })

    await seedPinnedProject(t.db, { userId: owner.id, projectId: zeta.project.id, position: 0 })
    // Triage: two errored default-branch builds with nothing after them in `mid`.
    await seedBuild(t.db, first.project.id, { branch: 'main', status: 'error' })
    await seedBuild(t.db, first.project.id, { branch: 'main', status: 'error' })
    // Reviews: one open request for the owner here, one for a mate, one in another org.
    const build = await seedBuild(t.db, alpha.project.id, { branch: 'feature' })
    await seedReviewRequest(t.db, { buildId: build.id, reviewerId: owner.id })
    await seedReviewRequest(t.db, { buildId: build.id, reviewerId: mate.id })
    const other = await seedProject(t.db)
    const otherBuild = await seedBuild(t.db, other.project.id, { branch: 'feature' })
    await addTestMember(t.db, { orgId: other.org.id, userId: owner.id })
    await seedReviewRequest(t.db, { buildId: otherBuild.id, reviewerId: owner.id })
    // Inbox: one unread, one read.
    await seedNotification(t.db, { userId: owner.id, kind: 'mentioned' })
    await seedNotification(t.db, { userId: owner.id, kind: 'mentioned', readAt: now })
    // Views: mine and someone else's.
    await seedSavedView(t.db, { userId: owner.id, orgId: org.id, name: 'Mine', position: 0 })
    await seedSavedView(t.db, { userId: mate.id, orgId: org.id, name: 'Theirs' })

    const bar = await getSidebar(t.db, { userId: owner.id, org, now })
    expect(bar.projects).toEqual([
      { slug: 'zeta', name: 'zeta', pinned: true, triage: 0 },
      { slug: 'alpha', name: 'alpha', pinned: false, triage: 0 },
      { slug: 'mid', name: 'mid', pinned: false, triage: 2 },
    ])
    expect(bar.reviews).toBe(1)
    expect(bar.inboxUnread).toBe(1)
    expect(bar.views.map((v) => v.name)).toEqual(['Mine'])

    const mates = await getSidebar(t.db, { userId: mate.id, org, now })
    expect(mates.projects.map((p) => p.pinned)).toEqual([false, false, false])
    expect(mates.reviews).toBe(1)
    expect(mates.views.map((v) => v.name)).toEqual(['Theirs'])
  })
})
