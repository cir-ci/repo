import { listBuildActivity } from '@circi/db/queries'
import { GIT_NOTIFY_QUEUE } from '@circi/db/queue'
import { createBuild } from '@circi/db/repositories'
import * as schema from '@circi/db/schema'
import {
  addTestMember,
  createTestDb,
  seedBuild,
  seedChangedSnapshots,
  seedGitLink,
  seedNotification,
  seedTeam,
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
  const { team, workspace, owner } = await seedTeam(t.db)
  const ann = await seedUser(t.db)
  const lou = await seedUser(t.db)
  await addTestMember(t.db, { workspaceId: workspace.id, userId: ann.id })
  await addTestMember(t.db, { workspaceId: workspace.id, userId: lou.id })
  const build = await createBuild(t.db, {
    teamId: team.id,
    commitSha: 'abc1234',
    branch: 'feature',
    author: { login: 'ann', userId: ann.id },
  })
  await t.db
    .update(schema.builds)
    .set({ status: 'complete', conclusion: 'changes_detected' })
    .where(eq(schema.builds.id, build.id))
  await seedGitLink(t.db, team.id, { externalId: '1', repoRef: 'acme/web' })
  await seedChangedSnapshots(t.db, build.id, ['a', 'b', 'c'])
  await t.db.delete(schema.jobs)
  return { team, owner, ann, lou, build }
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
    const { team, owner, ann, build } = await setup()
    // `a` was rejected with a reason; the owner then approves everything.
    await reviewSnapshotsUndoable(t.db, {
      teamId: team.id,
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
      teamId: team.id,
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

    await undoAction(t.db, { id: undo?.id ?? '', userId: owner.id, teamId: team.id })

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
    const { team, owner, lou, build } = await setup()
    await requestReviewsUndoable(t.db, {
      teamId: team.id,
      buildIds: [build.id],
      reviewerIds: [lou.id],
      requestedById: owner.id,
    })
    const { undo } = await reviewSnapshotsUndoable(t.db, {
      teamId: team.id,
      buildId: build.id,
      userId: owner.id,
      decision: 'approved',
      snapshotNames: ['a', 'b', 'c'],
    })
    const requests = () =>
      t.db.select().from(schema.reviewRequests).where(eq(schema.reviewRequests.buildId, build.id))
    expect((await requests())[0]?.state).toBe('done')

    await undoAction(t.db, { id: undo?.id ?? '', userId: owner.id, teamId: team.id })
    expect((await buildRow(build.id))?.reviewStatus).toBe('pending')
    expect(await current(build.id)).toEqual([])
    expect((await requests())[0]?.state).toBe('open')
  })

  it('has no token when the decision changed nothing', async () => {
    const { team, owner, build } = await setup()
    const first = await reviewBuildUndoable(t.db, {
      teamId: team.id,
      buildId: build.id,
      userId: owner.id,
      state: 'approved',
    })
    const again = await reviewBuildUndoable(t.db, {
      teamId: team.id,
      buildId: build.id,
      userId: owner.id,
      state: 'approved',
    })
    expect(first.undo).not.toBeNull()
    expect(again.undo).toBeNull()
  })

  it('refuses another person (403), a stale undo (409), a second undo and an expired one', async () => {
    const { team, owner, lou, build } = await setup()
    const decide = (userId: string, decision: 'approved' | 'rejected', names: string[]) =>
      reviewSnapshotsUndoable(t.db, {
        teamId: team.id,
        buildId: build.id,
        userId,
        decision,
        snapshotNames: names,
        ...(decision === 'rejected' ? { reason: 'no' } : {}),
      })
    const mine = await decide(owner.id, 'approved', ['a', 'b'])
    const undo = { id: mine.undo?.id ?? '', teamId: team.id }

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
    await undoAction(t.db, { id, userId: owner.id, teamId: team.id })
    await expect(undoAction(t.db, { id, userId: owner.id, teamId: team.id })).rejects.toMatchObject(
      { name: 'ConflictError', message: 'Already undone' },
    )
    // Expired.
    const late = await decide(owner.id, 'approved', ['c'])
    await expect(
      undoAction(t.db, {
        id: late.undo?.id ?? '',
        userId: owner.id,
        teamId: team.id,
        now: new Date(Date.now() + UNDO_WINDOW_MS + 1000),
      }),
    ).rejects.toMatchObject({ name: 'ConflictError', message: "It's too late to undo that" })
    // Wrong scope: the inbox route does not know a team's token.
    await expect(
      undoAction(t.db, { id: late.undo?.id ?? '', userId: owner.id, teamId: null }),
    ).rejects.toMatchObject({ name: 'NotFoundError' })
  })

  it('restores a build decided as a whole when it has no changes', async () => {
    const { team, owner } = await seedTeam(t.db)
    await t.db.update(schema.teams).set({ autoApproveNoChanges: false })
    const build = await seedBuild(t.db, team.id, { status: 'complete' })
    await t.db
      .update(schema.builds)
      .set({ conclusion: 'no_changes' })
      .where(eq(schema.builds.id, build.id))
    const { undo } = await reviewBuildUndoable(t.db, {
      teamId: team.id,
      buildId: build.id,
      userId: owner.id,
      state: 'approved',
    })
    expect((await buildRow(build.id))?.reviewStatus).toBe('approved')
    await undoAction(t.db, { id: undo?.id ?? '', userId: owner.id, teamId: team.id })
    expect((await buildRow(build.id))?.reviewStatus).toBe('pending')
  })
})

async function triage() {
  const { team, workspace, owner } = await seedTeam(t.db)
  const mate = await seedUser(t.db)
  await addTestMember(t.db, { workspaceId: workspace.id, userId: mate.id })
  const failed = await seedBuild(t.db, team.id, { branch: 'main', status: 'error' })
  const ref = { teamId: team.id, kind: 'failed', key: `build:${failed.number}` }
  const row = async () =>
    (await t.db.select().from(schema.triageItems).where(eq(schema.triageItems.teamId, team.id)))[0]
  return { team, owner, mate, ref, row }
}

describe('undo of triage actions', () => {
  it('puts the previous assignee back, and refuses once someone assigned it since', async () => {
    const { team, owner, mate, ref, row } = await triage()
    await assignTriageUndoable(t.db, { ...ref, assigneeId: owner.id, userId: owner.id })
    const { undo } = await assignTriageUndoable(t.db, {
      ...ref,
      assigneeId: mate.id,
      userId: owner.id,
    })
    expect((await row())?.assigneeId).toBe(mate.id)
    await undoAction(t.db, { id: undo?.id ?? '', userId: owner.id, teamId: team.id })
    expect((await row())?.assigneeId).toBe(owner.id)

    const second = await assignTriageUndoable(t.db, {
      ...ref,
      assigneeId: mate.id,
      userId: owner.id,
    })
    await assignTriageUndoable(t.db, { ...ref, assigneeId: null, userId: mate.id })
    await expect(
      undoAction(t.db, { id: second.undo?.id ?? '', userId: owner.id, teamId: team.id }),
    ).rejects.toMatchObject({ name: 'ConflictError' })
    expect((await row())?.assigneeId).toBeNull()
  })

  it('unsnoozes, and restores an earlier snooze', async () => {
    const { team, owner, ref, row } = await triage()
    const first = await snoozeTriageUndoable(t.db, { ...ref, choice: 'tomorrow', userId: owner.id })
    const second = await snoozeTriageUndoable(t.db, {
      ...ref,
      choice: 'next_week',
      userId: owner.id,
    })
    const nextWeek = (await row())?.snoozedUntil
    expect(nextWeek).not.toEqual((await row())?.createdAt)
    await undoAction(t.db, { id: second.undo?.id ?? '', userId: owner.id, teamId: team.id })
    expect((await row())?.snoozeKind).toBe('tomorrow')
    await undoAction(t.db, { id: first.undo?.id ?? '', userId: owner.id, teamId: team.id })
    expect((await row())?.snoozeKind).toBeNull()
    expect((await row())?.snoozedUntil).toBeNull()
  })

  it('un-dismisses, and refuses another person', async () => {
    const { team, owner, mate, ref, row } = await triage()
    const { undo } = await dismissTriageUndoable(t.db, { ...ref, userId: owner.id })
    expect((await row())?.dismissedAt).not.toBeNull()
    await expect(
      undoAction(t.db, { id: undo?.id ?? '', userId: mate.id, teamId: team.id }),
    ).rejects.toMatchObject({ name: 'ForbiddenError' })
    await undoAction(t.db, { id: undo?.id ?? '', userId: owner.id, teamId: team.id })
    expect((await row())?.dismissedAt).toBeNull()
  })
})

describe('undo of inbox actions', () => {
  it('restores read, snoozed and removed notices exactly', async () => {
    const { owner } = await seedTeam(t.db)
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
    await undoAction(t.db, { id: read.undo?.id ?? '', userId: owner.id, teamId: null })
    expect((await row())?.readAt).toBeNull()

    const snoozed = await snoozeNotificationUndoable(t.db, {
      userId: owner.id,
      id: n.id,
      choice: 'tomorrow',
    })
    expect((await row())?.snoozedUntil).not.toBeNull()
    await undoAction(t.db, { id: snoozed.undo?.id ?? '', userId: owner.id, teamId: null })
    expect((await row())?.snoozedUntil).toBeNull()

    const removed = await removeNotificationUndoable(t.db, { userId: owner.id, id: n.id })
    expect((await row())?.deletedAt).not.toBeNull()
    await expect(
      undoAction(t.db, { id: removed.undo?.id ?? '', userId: other.id, teamId: null }),
    ).rejects.toMatchObject({ name: 'ForbiddenError' })
    await undoAction(t.db, { id: removed.undo?.id ?? '', userId: owner.id, teamId: null })
    expect((await row())?.deletedAt).toBeNull()
  })

  it('has no token when reading what was already read, and refuses a stale undo', async () => {
    const { owner } = await seedTeam(t.db)
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
      undoAction(t.db, { id: first.undo?.id ?? '', userId: owner.id, teamId: null }),
    ).rejects.toMatchObject({ name: 'ConflictError' })
  })
})

describe('undo of review requests', () => {
  it('cancels the requests it opened and takes back their notices', async () => {
    const { team, owner, lou, build } = await setup()
    const { undo, requests } = await requestReviewsUndoable(t.db, {
      teamId: team.id,
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
    await undoAction(t.db, { id: undo?.id ?? '', userId: owner.id, teamId: team.id })
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
    const { team, owner, lou, build } = await setup()
    const input = {
      teamId: team.id,
      buildIds: [build.id],
      reviewerIds: [lou.id],
      requestedById: owner.id,
    }
    const first = await requestReviewsUndoable(t.db, input)
    expect((await requestReviewsUndoable(t.db, input)).undo).toBeNull()
    await reviewBuild(t.db, { buildId: build.id, userId: lou.id, state: 'approved' })
    await expect(
      undoAction(t.db, { id: first.undo?.id ?? '', userId: owner.id, teamId: team.id }),
    ).rejects.toMatchObject({ name: 'ConflictError' })
  })

  it('puts a snooze of a request back, only for as long as it is the same snooze', async () => {
    const { team, owner, lou, build } = await setup()
    const { requests } = await requestReviewsUndoable(t.db, {
      teamId: team.id,
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
      teamId: team.id,
      requestId,
      userId: lou.id,
      kind: 'tomorrow',
    })
    expect((await row())?.snoozeKind).toBe('tomorrow')
    await undoAction(t.db, { id: first.undo.id, userId: lou.id, teamId: team.id })
    expect((await row())?.snoozeKind).toBeNull()

    const second = await snoozeReviewRequestUndoable(t.db, {
      teamId: team.id,
      requestId,
      userId: lou.id,
      kind: 'tomorrow',
    })
    await snoozeReviewRequestUndoable(t.db, {
      teamId: team.id,
      requestId,
      userId: lou.id,
      kind: 'next_week',
    })
    await expect(
      undoAction(t.db, { id: second.undo.id, userId: lou.id, teamId: team.id }),
    ).rejects.toMatchObject({ name: 'ConflictError' })
  })
})
