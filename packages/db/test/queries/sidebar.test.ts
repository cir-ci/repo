import { projectColorFor } from '@circi/core'
import {
  addTestMember,
  createTestDb,
  seedBuild,
  seedMember,
  seedNotification,
  seedPinnedProject,
  seedProject,
  seedReviewRequest,
  seedSavedView,
} from '@circi/db/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { projectSites } from '#schema/index.ts'
import { getSidebar } from '#src/queries/index.ts'
import {
  assignTriageItem,
  refreshTriageProblems,
  snoozeTriageItem,
} from '#src/repositories/index.ts'

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
    const { workspace, owner } = first
    const zeta = await seedProject(t.db, { workspace: { workspace, owner }, slug: 'zeta' })
    const alpha = await seedProject(t.db, { workspace: { workspace, owner }, slug: 'alpha' })
    const mate = await seedMember(t.db, workspace.id)

    await seedPinnedProject(t.db, { userId: owner.id, projectId: zeta.project.id, position: 0 })
    // Triage: two errored default-branch builds with nothing after them in `mid`.
    await seedBuild(t.db, first.project.id, { branch: 'main', status: 'error' })
    await seedBuild(t.db, first.project.id, { branch: 'main', status: 'error' })
    // Reviews: one open request for the owner here, one for a mate, one in another workspace.
    const build = await seedBuild(t.db, alpha.project.id, { branch: 'feature' })
    await seedReviewRequest(t.db, { buildId: build.id, reviewerId: owner.id })
    await seedReviewRequest(t.db, { buildId: build.id, reviewerId: mate.id })
    const other = await seedProject(t.db)
    const otherBuild = await seedBuild(t.db, other.project.id, { branch: 'feature' })
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

    // The seeders write builds directly, so the stored queue is brought up to date by hand.
    await refreshTriageProblems(t.db, first.project.id)
    const bar = await getSidebar(t.db, { userId: owner.id, workspace, now })
    expect(
      bar.projects.map(({ slug, name, pinned, triage }) => ({ slug, name, pinned, triage })),
    ).toEqual([
      { slug: 'zeta', name: 'zeta', pinned: true, triage: 0 },
      { slug: 'alpha', name: 'alpha', pinned: false, triage: 0 },
      { slug: 'mid', name: 'mid', pinned: false, triage: 2 },
    ])
    // Each project carries its tile: a colour from its name, and no icon until one is chosen.
    expect(bar.projects.map((p) => [p.color, p.icon])).toEqual([
      [projectColorFor('zeta'), null],
      [projectColorFor('alpha'), null],
      [projectColorFor('mid'), null],
    ])
    expect(bar.reviews).toBe(1)
    expect(bar.inboxUnread).toBe(1)
    expect(bar.views.map((v) => v.name)).toEqual(['Mine'])

    const mates = await getSidebar(t.db, { userId: mate.id, workspace, now })
    expect(mates.projects.map((p) => p.pinned)).toEqual([false, false, false])
    expect(mates.reviews).toBe(1)
    expect(mates.views.map((v) => v.name)).toEqual(['Theirs'])
  })

  it("counts the awake triage items assigned to the person, not those asleep or someone else's", async () => {
    const one = await seedProject(t.db, { slug: 'queue' })
    const { workspace, owner } = one
    const mate = await seedMember(t.db, workspace.id)
    const failed = await seedBuild(t.db, one.project.id, { branch: 'main', status: 'error' })
    const failed2 = await seedBuild(t.db, one.project.id, { branch: 'main', status: 'error' })
    const failed3 = await seedBuild(t.db, one.project.id, { branch: 'main', status: 'error' })
    const ref = (n: number) => ({
      projectId: one.project.id,
      kind: 'failed' as const,
      key: `build:${n}`,
    })
    await assignTriageItem(t.db, { ...ref(failed.number), assigneeId: owner.id })
    await assignTriageItem(t.db, { ...ref(failed2.number), assigneeId: owner.id })
    await assignTriageItem(t.db, { ...ref(failed3.number), assigneeId: mate.id })
    await snoozeTriageItem(t.db, {
      ...ref(failed2.number),
      snoozeKind: 'tomorrow',
      snoozedUntil: new Date(now.getTime() + 86_400_000),
      snoozedAfterBuild: null,
    })
    expect((await getSidebar(t.db, { userId: owner.id, workspace, now })).triageAssigned).toBe(1)
    expect((await getSidebar(t.db, { userId: mate.id, workspace, now })).triageAssigned).toBe(1)
  })

  it('counts the sites each project hosts', async () => {
    const withSites = await seedProject(t.db, { slug: 'with-sites' })
    const { workspace, owner } = withSites
    await seedProject(t.db, { workspace: { workspace, owner }, slug: 'no-sites' })
    await t.db.insert(projectSites).values([
      { projectId: withSites.project.id, name: 'Storybook', kind: 'storybook', slug: 'sb-sites-1' },
      { projectId: withSites.project.id, name: 'Docs', kind: 'docs', slug: 'docs-sites-1' },
    ])
    const bar = await getSidebar(t.db, { userId: owner.id, workspace, now })
    expect(bar.projects.map((p) => [p.slug, p.siteCount])).toEqual([
      ['no-sites', 0],
      ['with-sites', 2],
    ])
  })
})
