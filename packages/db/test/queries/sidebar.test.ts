import { teamColorFor } from '@circi/core'
import {
  addTestMember,
  createTestDb,
  seedBuild,
  seedNotification,
  seedPinnedTeam,
  seedTeam,
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
  it('orders pinned teams first then A to Z, with known counts', async () => {
    const first = await seedTeam(t.db, { slug: 'mid' })
    const { workspace, owner } = first
    const zeta = await seedTeam(t.db, { workspace: { workspace, owner }, slug: 'zeta' })
    const alpha = await seedTeam(t.db, { workspace: { workspace, owner }, slug: 'alpha' })
    const mate = await seedUser(t.db)
    await addTestMember(t.db, { workspaceId: workspace.id, userId: mate.id })

    await seedPinnedTeam(t.db, { userId: owner.id, teamId: zeta.team.id, position: 0 })
    // Triage: two errored default-branch builds with nothing after them in `mid`.
    await seedBuild(t.db, first.team.id, { branch: 'main', status: 'error' })
    await seedBuild(t.db, first.team.id, { branch: 'main', status: 'error' })
    // Reviews: one open request for the owner here, one for a mate, one in another workspace.
    const build = await seedBuild(t.db, alpha.team.id, { branch: 'feature' })
    await seedReviewRequest(t.db, { buildId: build.id, reviewerId: owner.id })
    await seedReviewRequest(t.db, { buildId: build.id, reviewerId: mate.id })
    const other = await seedTeam(t.db)
    const otherBuild = await seedBuild(t.db, other.team.id, { branch: 'feature' })
    await addTestMember(t.db, { workspaceId: other.workspace.id, userId: owner.id })
    await seedReviewRequest(t.db, { buildId: otherBuild.id, reviewerId: owner.id })
    // Inbox: one unread, one read.
    await seedNotification(t.db, { userId: owner.id, kind: 'mentioned' })
    await seedNotification(t.db, { userId: owner.id, kind: 'mentioned', readAt: now })
    // Views: mine and someone else's.
    await seedSavedView(t.db, {
      userId: owner.id,
      workspaceId: workspace.id,
      name: 'Mine',
      position: 0,
    })
    await seedSavedView(t.db, { userId: mate.id, workspaceId: workspace.id, name: 'Theirs' })

    const bar = await getSidebar(t.db, { userId: owner.id, workspace, now })
    expect(
      bar.teams.map(({ slug, name, pinned, triage }) => ({ slug, name, pinned, triage })),
    ).toEqual([
      { slug: 'zeta', name: 'zeta', pinned: true, triage: 0 },
      { slug: 'alpha', name: 'alpha', pinned: false, triage: 0 },
      { slug: 'mid', name: 'mid', pinned: false, triage: 2 },
    ])
    // Each team carries its tile: a colour from its name, and no icon until one is chosen.
    expect(bar.teams.map((p) => [p.color, p.icon])).toEqual([
      [teamColorFor('zeta'), null],
      [teamColorFor('alpha'), null],
      [teamColorFor('mid'), null],
    ])
    expect(bar.reviews).toBe(1)
    expect(bar.inboxUnread).toBe(1)
    expect(bar.views.map((v) => v.name)).toEqual(['Mine'])

    const mates = await getSidebar(t.db, { userId: mate.id, workspace, now })
    expect(mates.teams.map((p) => p.pinned)).toEqual([false, false, false])
    expect(mates.reviews).toBe(1)
    expect(mates.views.map((v) => v.name)).toEqual(['Theirs'])
  })
})
