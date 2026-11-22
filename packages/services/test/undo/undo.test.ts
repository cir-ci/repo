import { listBuildActivity } from '@circi/db/queries'
import { GIT_NOTIFY_QUEUE } from '@circi/db/queue'
import * as schema from '@circi/db/schema'
import {
  addTestMember,
  createTestDb,
  seedBuild,
  seedGitLink,
  seedMember,
  seedNotification,
  seedProject,
  seedUser,
} from '@circi/db/testing'
import { and, eq, isNull } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  assignTriageUndoable,
  dismissTriageUndoable,
  markNotificationReadUndoable,
  removeNotificationUndoable,
  requestReviewsUndoable,
  reviewBuild,
  reviewBuildUndoable,
  reviewSnapshotsUndoable,
  snoozeNotificationUndoable,
  snoozeReviewRequestUndoable,
  snoozeTriageUndoable,
  unsnoozeNotificationUndoable,
  unsnoozeReviewRequestUndoable,
  unsnoozeTriageUndoable,
  UNDO_WINDOW_MS,
  undoAction,
} from '#src/index.ts'

let t: createTestDb.Result
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(async () => {
  await t.close()
})

const jobs = async (queue: string) =>
  t.db.select().from(schema.jobs).where(eq(schema.jobs.queue, queue))

/** A finished build with changes to `a`, `b` and `c`, written by `ann`; the owner and `lou` may review. */
async function setup() {
  const { project, workspace, owner } = await seedProject(t.db)
  const ann = await seedUser(t.db)
  const lou = await seedUser(t.db)
  await addTestMember(t.db, { workspaceId: workspace.id, userId: ann.id })
  await addTestMember(t.db, { workspaceId: workspace.id, userId: lou.id })
  const build = await seedBuild(t.db, project.id, {
    commitSha: 'abc1234',
    branch: 'feature',
    author: { login: 'ann', userId: ann.id },
    status: 'complete',
    conclusion: 'changes_detected',
    changedSnapshots: ['a', 'b', 'c'],
  })
  await seedGitLink(t.db, project.id, { externalId: '1', repoRef: 'acme/web' })
  await t.db.delete(schema.jobs)
  return { project, owner, ann, lou, build }
}

const buildRow = async (id: string) =>
  (await t.db.select().from(schema.builds).where(eq(schema.builds.id, id)))[0]

const current = async (buildId: string) =>
  (
    await t.db
      .select()
      .from(schema.snapshotReviews)
      .where(
        and(
          eq(schema.snapshotReviews.buildId, buildId),
          isNull(schema.snapshotReviews.supersededAt),
        ),
      )
  )
    .map((r) => `${r.snapshotName}:${r.decision}:${r.reason ?? ''}`)
    .toSorted()

const all = async (buildId: string) =>
  t.db.select().from(schema.snapshotReviews).where(eq(schema.snapshotReviews.buildId, buildId))

describe('undo of a build decision', () => {
  it('restores the earlier decisions, reasons and status exactly, and keeps the history', async () => {
    const { project, owner, ann, build } = await setup()
    // `a` was rejected with a reason; the owner then approves everything.
    await reviewSnapshotsUndoable(t.db, {
      projectId: project.id,
      buildId: build.id,
      userId: owner.id,
      decision: 'rejected',
      snapshotNames: ['a'],
      reason: 'Off by two pixels',
    })
    expect(await current(build.id)).toEqual(['a:rejected:Off by two pixels'])
    expect((await buildRow(build.id))?.reviewStatus).toBe('rejected')
    await t.db.delete(schema.jobs)

    const { undo } = await reviewBuildUndoable(t.db, {
      projectId: project.id,
      buildId: build.id,
      userId: owner.id,
      state: 'approved',
    })
    expect(undo).not.toBeNull()
    expect((await buildRow(build.id))?.reviewStatus).toBe('approved')
    expect(await current(build.id)).toEqual(['a:approved:', 'b:approved:', 'c:approved:'])
    // The author heard about the approval; the check run was queued.
    const notices = () =>
      t.db
        .select()
        .from(schema.notifications)
        .where(and(eq(schema.notifications.userId, ann.id), isNull(schema.notifications.deletedAt)))
    expect((await notices()).map((n) => n.kind)).toContain('build_approved')
    expect(await jobs(GIT_NOTIFY_QUEUE)).toHaveLength(1)
    await t.db.delete(schema.jobs)

    await undoAction(t.db, { id: undo?.id ?? '', userId: owner.id, projectId: project.id })

    expect((await buildRow(build.id))?.reviewStatus).toBe('rejected')
    expect(await current(build.id)).toEqual(['a:rejected:Off by two pixels'])
    // History kept: the rows of the undone decision are superseded, not deleted.
    expect(await all(build.id)).toHaveLength(4)
    // The author's approval notice is gone, and the check run followed the undo.
    expect((await notices()).map((n) => n.kind)).not.toContain('build_approved')
    expect(await jobs(GIT_NOTIFY_QUEUE)).toHaveLength(1)
    const activity = await listBuildActivity(t.db, build.id)
    expect(activity.filter((e) => e.type === 'review_undone')).toMatchObject([
      { decision: 'approved', snapshotNames: ['b', 'c', 'a'].toSorted(), by: { id: owner.id } },
    ])
  })

  it('goes back to needs review for a screenshot decision, and reopens the review requests it closed', async () => {
    const { project, owner, lou, build } = await setup()
    await requestReviewsUndoable(t.db, {
      projectId: project.id,
      buildIds: [build.id],
      reviewerIds: [lou.id],
      requestedById: owner.id,
    })
    const { undo } = await reviewSnapshotsUndoable(t.db, {
      projectId: project.id,
      buildId: build.id,
      userId: owner.id,
      decision: 'approved',
      snapshotNames: ['a', 'b', 'c'],
    })
    const requests = () =>
      t.db.select().from(schema.reviewRequests).where(eq(schema.reviewRequests.buildId, build.id))
    expect((await requests())[0]?.state).toBe('done')

    await undoAction(t.db, { id: undo?.id ?? '', userId: owner.id, projectId: project.id })
    expect((await buildRow(build.id))?.reviewStatus).toBe('pending')
    expect(await current(build.id)).toEqual([])
    expect((await requests())[0]?.state).toBe('open')
  })

  it('has no token when the decision changed nothing', async () => {
    const { project, owner, build } = await setup()
    const first = await reviewBuildUndoable(t.db, {
      projectId: project.id,
      buildId: build.id,
      userId: owner.id,
      state: 'approved',
    })
    const again = await reviewBuildUndoable(t.db, {
      projectId: project.id,
      buildId: build.id,
      userId: owner.id,
      state: 'approved',
    })
    expect(first.undo).not.toBeNull()
    expect(again.undo).toBeNull()
  })

  it('refuses another person (403), a stale undo (409), a second undo and an expired one', async () => {
    const { project, owner, lou, build } = await setup()
    const decide = (userId: string, decision: 'approved' | 'rejected', names: string[]) =>
      reviewSnapshotsUndoable(t.db, {
        projectId: project.id,
        buildId: build.id,
        userId,
        decision,
        snapshotNames: names,
        ...(decision === 'rejected' ? { reason: 'no' } : {}),
      })
    const mine = await decide(owner.id, 'approved', ['a', 'b'])
    const undo = { id: mine.undo?.id ?? '', projectId: project.id }

    await expect(undoAction(t.db, { ...undo, userId: lou.id })).rejects.toMatchObject({
      name: 'ForbiddenError',
    })
    // Someone else rejects `a` afterwards: undoing the approval would overwrite that.
    await decide(lou.id, 'rejected', ['a'])
    await expect(undoAction(t.db, { ...undo, userId: owner.id })).rejects.toMatchObject({
      name: 'ConflictError',
      message: expect.stringContaining('Someone changed this review'),
    })
    expect(await current(build.id)).toEqual(['a:rejected:no', 'b:approved:'])

    // Single use.
    const fresh = await decide(owner.id, 'approved', ['c'])
    const id = fresh.undo?.id ?? ''
    await undoAction(t.db, { id, userId: owner.id, projectId: project.id })
    await expect(
      undoAction(t.db, { id, userId: owner.id, projectId: project.id }),
    ).rejects.toMatchObject({ name: 'ConflictError', message: 'Already undone' })
    // Expired.
    const late = await decide(owner.id, 'approved', ['c'])
    await expect(
      undoAction(t.db, {
        id: late.undo?.id ?? '',
        userId: owner.id,
        projectId: project.id,
        now: new Date(Date.now() + UNDO_WINDOW_MS + 1000),
      }),
    ).rejects.toMatchObject({ name: 'ConflictError', message: "It's too late to undo that" })
    // Wrong scope: the inbox route does not know a project's token.
    await expect(
      undoAction(t.db, { id: late.undo?.id ?? '', userId: owner.id, projectId: null }),
    ).rejects.toMatchObject({ name: 'NotFoundError' })
  })

  it('restores a build decided as a whole when it has no changes', async () => {
    const { project, owner } = await seedProject(t.db)
    await t.db.update(schema.projects).set({ autoApproveNoChanges: false })
    const build = await seedBuild(t.db, project.id, { status: 'complete' })
    await t.db
      .update(schema.builds)
      .set({ conclusion: 'no_changes' })
      .where(eq(schema.builds.id, build.id))
    const { undo } = await reviewBuildUndoable(t.db, {
      projectId: project.id,
      buildId: build.id,
      userId: owner.id,
      state: 'approved',
    })
    expect((await buildRow(build.id))?.reviewStatus).toBe('approved')
    await undoAction(t.db, { id: undo?.id ?? '', userId: owner.id, projectId: project.id })
    expect((await buildRow(build.id))?.reviewStatus).toBe('pending')
  })
})

async function triage() {
  const { project, workspace, owner } = await seedProject(t.db)
  const mate = await seedMember(t.db, workspace.id)
  const failed = await seedBuild(t.db, project.id, { branch: 'main', status: 'error' })
  const ref = { projectId: project.id, kind: 'failed', key: `build:${failed.number}` }
  const row = async () =>
    (
      await t.db
        .select()
        .from(schema.triageItems)
        .where(eq(schema.triageItems.projectId, project.id))
    )[0]
  return { project, owner, mate, ref, row }
}

describe('undo of triage actions', () => {
  it('puts the previous assignee back, and refuses once someone assigned it since', async () => {
    const { project, owner, mate, ref, row } = await triage()
    await assignTriageUndoable(t.db, { ...ref, assigneeId: owner.id, userId: owner.id })
    const { undo } = await assignTriageUndoable(t.db, {
      ...ref,
      assigneeId: mate.id,
      userId: owner.id,
    })
    expect((await row())?.assigneeId).toBe(mate.id)
    await undoAction(t.db, { id: undo?.id ?? '', userId: owner.id, projectId: project.id })
    expect((await row())?.assigneeId).toBe(owner.id)

    const second = await assignTriageUndoable(t.db, {
      ...ref,
      assigneeId: mate.id,
      userId: owner.id,
    })
    await assignTriageUndoable(t.db, { ...ref, assigneeId: null, userId: mate.id })
    await expect(
      undoAction(t.db, { id: second.undo?.id ?? '', userId: owner.id, projectId: project.id }),
    ).rejects.toMatchObject({ name: 'ConflictError' })
    expect((await row())?.assigneeId).toBeNull()
  })

  it('unsnoozes, and restores an earlier snooze', async () => {
    const { project, owner, ref, row } = await triage()
    const first = await snoozeTriageUndoable(t.db, { ...ref, choice: 'tomorrow', userId: owner.id })
    const second = await snoozeTriageUndoable(t.db, {
      ...ref,
      choice: 'next_week',
      userId: owner.id,
    })
    const nextWeek = (await row())?.snoozedUntil
    expect(nextWeek).not.toEqual((await row())?.createdAt)
    await undoAction(t.db, { id: second.undo?.id ?? '', userId: owner.id, projectId: project.id })
    expect((await row())?.snoozeKind).toBe('tomorrow')
    await undoAction(t.db, { id: first.undo?.id ?? '', userId: owner.id, projectId: project.id })
    expect((await row())?.snoozeKind).toBeNull()
    expect((await row())?.snoozedUntil).toBeNull()
  })

  it('unsnoozes early, undo snoozes again as it was, and an item not snoozed gives no token', async () => {
    const { project, owner, ref, row } = await triage()
    // Nobody has touched the item: nothing is woken and no row is made for it.
    const untouched = await unsnoozeTriageUndoable(t.db, { ...ref, userId: owner.id })
    expect(untouched.undo).toBeNull()
    expect(untouched.item).toMatchObject({ kind: 'failed', key: ref.key, snoozeKind: null })
    expect(await row()).toBeUndefined()
    // Any kind and key used to create a row; now an unknown key makes none, and a bad kind is refused.
    await unsnoozeTriageUndoable(t.db, { ...ref, key: 'build:9999', userId: owner.id })
    expect(await row()).toBeUndefined()
    await expect(
      unsnoozeTriageUndoable(t.db, { ...ref, kind: 'nonsense', userId: owner.id }),
    ).rejects.toMatchObject({ name: 'ValidationError' })
    await snoozeTriageUndoable(t.db, { ...ref, choice: 'next_week', userId: owner.id })
    const before = await row()
    const { undo, item } = await unsnoozeTriageUndoable(t.db, { ...ref, userId: owner.id })
    expect(item).toMatchObject({ snoozeKind: null, snoozedUntil: null })
    expect(undo).not.toBeNull()
    await undoAction(t.db, { id: undo?.id ?? '', userId: owner.id, projectId: project.id })
    expect((await row())?.snoozeKind).toBe('next_week')
    expect((await row())?.snoozedUntil).toEqual(before?.snoozedUntil)
  })

  it('un-dismisses, and refuses another person', async () => {
    const { project, owner, mate, ref, row } = await triage()
    const { undo } = await dismissTriageUndoable(t.db, { ...ref, userId: owner.id })
    expect((await row())?.dismissedAt).not.toBeNull()
    await expect(
      undoAction(t.db, { id: undo?.id ?? '', userId: mate.id, projectId: project.id }),
    ).rejects.toMatchObject({ name: 'ForbiddenError' })
    await undoAction(t.db, { id: undo?.id ?? '', userId: owner.id, projectId: project.id })
    expect((await row())?.dismissedAt).toBeNull()
  })
})

describe('undo of inbox actions', () => {
  it('restores read, snoozed and removed notices exactly', async () => {
    const { owner } = await seedProject(t.db)
    const other = await seedUser(t.db)
    const n = await seedNotification(t.db, { userId: owner.id })
    const row = async () =>
      (await t.db.select().from(schema.notifications).where(eq(schema.notifications.id, n.id)))[0]

    const read = await markNotificationReadUndoable(t.db, {
      userId: owner.id,
      id: n.id,
      read: true,
    })
    expect((await row())?.readAt).not.toBeNull()
    await undoAction(t.db, { id: read.undo?.id ?? '', userId: owner.id, projectId: null })
    expect((await row())?.readAt).toBeNull()

    const snoozed = await snoozeNotificationUndoable(t.db, {
      userId: owner.id,
      id: n.id,
      choice: 'tomorrow',
    })
    expect((await row())?.snoozedUntil).not.toBeNull()
    await undoAction(t.db, { id: snoozed.undo?.id ?? '', userId: owner.id, projectId: null })
    expect((await row())?.snoozedUntil).toBeNull()

    const removed = await removeNotificationUndoable(t.db, { userId: owner.id, id: n.id })
    expect((await row())?.deletedAt).not.toBeNull()
    await expect(
      undoAction(t.db, { id: removed.undo?.id ?? '', userId: other.id, projectId: null }),
    ).rejects.toMatchObject({ name: 'ForbiddenError' })
    await undoAction(t.db, { id: removed.undo?.id ?? '', userId: owner.id, projectId: null })
    expect((await row())?.deletedAt).toBeNull()
  })

  it('unsnoozes a notice, undo snoozes it again to the same time, and an awake one gives no token', async () => {
    const { owner } = await seedProject(t.db)
    const n = await seedNotification(t.db, { userId: owner.id })
    const row = async () =>
      (await t.db.select().from(schema.notifications).where(eq(schema.notifications.id, n.id)))[0]
    expect(
      (await unsnoozeNotificationUndoable(t.db, { userId: owner.id, id: n.id })).undo,
    ).toBeNull()
    await snoozeNotificationUndoable(t.db, { userId: owner.id, id: n.id, choice: 'next_week' })
    const until = (await row())?.snoozedUntil
    expect(until).not.toBeNull()
    const { notification, undo } = await unsnoozeNotificationUndoable(t.db, {
      userId: owner.id,
      id: n.id,
    })
    expect(notification.snoozedUntil).toBeNull()
    await undoAction(t.db, { id: undo?.id ?? '', userId: owner.id, projectId: null })
    expect((await row())?.snoozedUntil).toEqual(until)
  })

  it('has no token when reading what was already read, and refuses a stale undo', async () => {
    const { owner } = await seedProject(t.db)
    const n = await seedNotification(t.db, { userId: owner.id })
    const first = await markNotificationReadUndoable(t.db, {
      userId: owner.id,
      id: n.id,
      read: true,
    })
    const again = await markNotificationReadUndoable(t.db, {
      userId: owner.id,
      id: n.id,
      read: true,
    })
    expect(again.undo).toBeNull()
    await markNotificationReadUndoable(t.db, { userId: owner.id, id: n.id, read: false })
    await expect(
      undoAction(t.db, { id: first.undo?.id ?? '', userId: owner.id, projectId: null }),
    ).rejects.toMatchObject({ name: 'ConflictError' })
  })
})

describe('undo of review requests', () => {
  it('cancels the requests it opened and takes back their notices', async () => {
    const { project, owner, lou, build } = await setup()
    const { undo, requests } = await requestReviewsUndoable(t.db, {
      projectId: project.id,
      buildIds: [build.id],
      reviewerIds: [lou.id],
      requestedById: owner.id,
    })
    const notices = () =>
      t.db
        .select()
        .from(schema.notifications)
        .where(and(eq(schema.notifications.userId, lou.id), isNull(schema.notifications.deletedAt)))
    expect(await notices()).toHaveLength(1)
    await undoAction(t.db, { id: undo?.id ?? '', userId: owner.id, projectId: project.id })
    expect(await notices()).toHaveLength(0)
    const row = (
      await t.db
        .select()
        .from(schema.reviewRequests)
        .where(eq(schema.reviewRequests.id, requests[0]?.request.id ?? ''))
    )[0]
    expect(row?.state).toBe('dismissed')
  })

  it('has no token when everyone was already asked, and is stale once the reviewer answered', async () => {
    const { project, owner, lou, build } = await setup()
    const input = {
      projectId: project.id,
      buildIds: [build.id],
      reviewerIds: [lou.id],
      requestedById: owner.id,
    }
    const first = await requestReviewsUndoable(t.db, input)
    expect((await requestReviewsUndoable(t.db, input)).undo).toBeNull()
    await reviewBuild(t.db, { buildId: build.id, userId: lou.id, state: 'approved' })
    await expect(
      undoAction(t.db, { id: first.undo?.id ?? '', userId: owner.id, projectId: project.id }),
    ).rejects.toMatchObject({ name: 'ConflictError' })
  })

  it('puts a snooze of a request back, only for as long as it is the same snooze', async () => {
    const { project, owner, lou, build } = await setup()
    const { requests } = await requestReviewsUndoable(t.db, {
      projectId: project.id,
      buildIds: [build.id],
      reviewerIds: [lou.id],
      requestedById: owner.id,
    })
    const requestId = requests[0]?.request.id ?? ''
    const row = async () =>
      (
        await t.db
          .select()
          .from(schema.reviewRequests)
          .where(eq(schema.reviewRequests.id, requestId))
      )[0]
    const first = await snoozeReviewRequestUndoable(t.db, {
      projectId: project.id,
      requestId,
      userId: lou.id,
      kind: 'tomorrow',
    })
    expect((await row())?.snoozeKind).toBe('tomorrow')
    await undoAction(t.db, { id: first.undo.id, userId: lou.id, projectId: project.id })
    expect((await row())?.snoozeKind).toBeNull()

    const second = await snoozeReviewRequestUndoable(t.db, {
      projectId: project.id,
      requestId,
      userId: lou.id,
      kind: 'tomorrow',
    })
    await snoozeReviewRequestUndoable(t.db, {
      projectId: project.id,
      requestId,
      userId: lou.id,
      kind: 'next_week',
    })
    await expect(
      undoAction(t.db, { id: second.undo.id, userId: lou.id, projectId: project.id }),
    ).rejects.toMatchObject({ name: 'ConflictError' })
  })

  it('unsnoozes a request, undo snoozes it again as it was, and an awake one gives no token', async () => {
    const { project, owner, build, lou } = await setup()
    const { requests } = await requestReviewsUndoable(t.db, {
      projectId: project.id,
      buildIds: [build.id],
      reviewerIds: [lou.id],
      requestedById: owner.id,
    })
    const requestId = requests[0]?.request.id ?? ''
    const row = async () =>
      (
        await t.db
          .select()
          .from(schema.reviewRequests)
          .where(eq(schema.reviewRequests.id, requestId))
      )[0]
    const input = { projectId: project.id, requestId, userId: lou.id }
    expect((await unsnoozeReviewRequestUndoable(t.db, input)).undo).toBeNull()
    await snoozeReviewRequestUndoable(t.db, { ...input, kind: 'next_week' })
    const before = await row()
    const { request, undo } = await unsnoozeReviewRequestUndoable(t.db, input)
    expect(request).toMatchObject({ snoozeKind: null, snoozedUntil: null })
    expect(undo).not.toBeNull()
    await undoAction(t.db, { id: undo?.id ?? '', userId: lou.id, projectId: project.id })
    expect((await row())?.snoozeKind).toBe('next_week')
    expect((await row())?.snoozedUntil).toEqual(before?.snoozedUntil)
  })
})
