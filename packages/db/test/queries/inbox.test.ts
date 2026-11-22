import * as schema from '@circi/db/schema'
import {
  addTestMember,
  createTestDb,
  seedBuild,
  seedMember,
  seedNotification,
  seedProject,
  seedReviewRequest,
  seedUser,
} from '@circi/db/testing'
import { and, eq } from 'drizzle-orm'
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
  const { project, workspace, owner } = await seedProject(t.db)
  const teammate = await seedMember(t.db, workspace.id)
  const build = await seedBuild(t.db, project.id, { branch: 'feature/x', prNumber: 7 })
  return { project, workspace, owner, teammate, build }
}
const tab = (userId: string, name: 'for-you' | 'everything' | 'snoozed') =>
  listInbox(t.db, { userId, tab: name, now })

describe('listInbox', () => {
  it('shows a notification with its build, project and actor, newest first', async () => {
    const { project, workspace, owner, teammate, build } = await setup()
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
      project: { slug: project.slug },
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

  it('shows a request as overdue only while its build is undecided', async () => {
    const { project, owner, teammate, build } = await setup()
    const decided = await seedBuild(t.db, project.id, { reviewStatus: 'approved' })
    for (const b of [build, decided]) {
      // oxlint-disable-next-line no-await-in-loop -- tiny fixed list
      await seedReviewRequest(t.db, {
        buildId: b.id,
        reviewerId: owner.id,
        requestedById: teammate.id,
        dueAt: new Date(now.getTime() - 3_600_000),
      })
      // oxlint-disable-next-line no-await-in-loop -- tiny fixed list
      await seedNotification(t.db, { userId: owner.id, buildId: b.id })
    }
    const items = (await tab(owner.id, 'for-you')).items
    const overdue = (buildId: string) =>
      items.find((i) => i.build?.number === (buildId === build.id ? build.number : decided.number))
        ?.request?.overdueByMs
    expect(overdue(build.id)).toBeGreaterThan(0)
    expect(overdue(decided.id)).toBe(0)
  })

  it('keeps project-wide notices to Everything', async () => {
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
    const { project, owner, teammate, build } = await setup()
    await seedNotification(t.db, { userId: teammate.id })
    expect((await tab(owner.id, 'everything')).items).toEqual([])

    const outsider = await seedUser(t.db)
    await seedNotification(t.db, { userId: outsider.id, buildId: build.id })
    await seedNotification(t.db, { userId: outsider.id, kind: 'flaky_detected' })
    // Not a member of the build's workspace: the build-bound one is hidden.
    const seen = (await tab(outsider.id, 'everything')).items
    expect(seen.map((i) => i.kind)).toEqual(['flaky_detected'])
    expect(project.id).toBeDefined()
  })
})

describe('workspace and project notices', () => {
  it('shows a connection notice to those who manage the workspace now, by role, membership and sign-in method', async () => {
    const { workspace, owner } = await setup()
    const admin = await seedUser(t.db)
    const demoted = await seedUser(t.db)
    const removed = await seedUser(t.db)
    await addTestMember(t.db, { workspaceId: workspace.id, userId: admin.id, role: 'admin' })
    await addTestMember(t.db, { workspaceId: workspace.id, userId: demoted.id, role: 'admin' })
    await addTestMember(t.db, { workspaceId: workspace.id, userId: removed.id, role: 'admin' })
    for (const u of [owner, admin, demoted, removed]) {
      // oxlint-disable-next-line no-await-in-loop -- four people
      await seedNotification(t.db, {
        userId: u.id,
        kind: 'connection_needs_attention',
        workspaceId: workspace.id,
        payload: { name: 'Slack' },
      })
    }
    const kinds = async (userId: string, method?: Parameters<typeof listInbox>[1]['method']) =>
      (await listInbox(t.db, { userId, tab: 'everything', now, ...(method ? { method } : {}) }))
        .items

    expect(await kinds(admin.id)).toHaveLength(1)
    expect((await kinds(admin.id))[0]).toMatchObject({ workspace: { slug: workspace.slug } })

    // Demoted to a plain member, and removed from the workspace: the notice is gone for them.
    await t.db
      .update(schema.member)
      .set({ role: 'member' })
      .where(and(eq(schema.member.userId, demoted.id), eq(schema.member.workspaceId, workspace.id)))
    await t.db
      .delete(schema.member)
      .where(and(eq(schema.member.userId, removed.id), eq(schema.member.workspaceId, workspace.id)))
    expect(await kinds(demoted.id)).toEqual([])
    expect(await kinds(removed.id)).toEqual([])
    expect(await countUnreadNotifications(t.db, { userId: removed.id, now })).toBe(0)

    // A session scoped to another workspace's sign-in can't see this workspace's notice.
    expect(await kinds(owner.id, { scopedTo: 'another-workspace' })).toEqual([])
    expect(await kinds(owner.id, { scopedTo: workspace.id })).toHaveLength(1)
  })

  it('shows a project notice without a build to those who can see the project', async () => {
    const { project, workspace, owner } = await setup()
    const outsider = await seedUser(t.db)
    await addTestMember(t.db, { workspaceId: workspace.id, userId: outsider.id, projects: [] })
    for (const u of [owner, outsider]) {
      // oxlint-disable-next-line no-await-in-loop -- two people
      await seedNotification(t.db, { userId: u.id, kind: 'flaky_detected', projectId: project.id })
    }
    expect((await tab(owner.id, 'everything')).items[0]).toMatchObject({
      project: { slug: project.slug },
      workspace: { slug: workspace.slug },
      build: null,
    })
    expect((await tab(outsider.id, 'everything')).items).toEqual([])
  })
})
