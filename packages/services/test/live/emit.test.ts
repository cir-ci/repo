import { decodeLiveNotice, encodeLiveNotice, type LiveNotice } from '@circi/core'
import { createBuild } from '@circi/db/repositories'
import { createTestDb, seedBuild, seedMember, seedProject } from '@circi/db/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  addComment,
  createIgnoreRegion,
  deleteWorkspace,
  restoreWorkspace,
  emitUserLive,
  LIVE_CHANNEL,
  markNotificationRead,
  notify,
  requestReview,
  reviewBuild,
  startBuildUpload,
  undoAction,
  reviewBuildUndoable,
} from '#src/index.ts'

/** What the services say on the live channel; PGlite's LISTEN stands in for Postgres (the same NOTIFY semantics). */

let t: createTestDb.Result
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(async () => {
  await t.close()
})

/** Collects the notices sent from now on. Notices arrive in the order they committed. */
async function listenLive() {
  const received: LiveNotice[] = []
  const stop = await t.listen(LIVE_CHANNEL, (payload) => {
    const notice = decodeLiveNotice(payload)
    if (notice) received.push(notice)
  })
  return {
    received,
    stop,
    /** Everything sent so far: a sentinel sent last proves nothing is still on its way. */
    async settled(): Promise<LiveNotice[]> {
      const marker = `marker-${Math.random()}`
      await emitUserLive(t.db, 'notification.read', marker)
      await expect.poll(() => received.some((n) => 'userId' in n && n.userId === marker)).toBe(true)
      return received.filter((n) => !('userId' in n && n.userId === marker))
    },
  }
}

async function setup() {
  const { project, workspace, owner } = await seedProject(t.db)
  const ann = await seedMember(t.db, workspace.id)
  const build = await createBuild(t.db, { projectId: project.id, commitSha: 'abc1234' })
  return { project, workspace, owner, ann, build }
}

describe('notices', () => {
  it('round-trip through their payload, and a payload from elsewhere is ignored', () => {
    const notices: LiveNotice[] = [
      { type: 'build.updated', projectId: 'p1', build: 4 },
      { type: 'triage.changed', projectId: 'p1' },
      { type: 'notification.created', userId: 'u1' },
      { type: 'build.updated', projectId: 'p1', workspaceId: 'w1', build: 4 },
      { type: 'access.changed', userId: 'u1' },
      { type: 'session.ended', userId: 'u1', sessionId: 's1' },
    ]
    for (const notice of notices) expect(decodeLiveNotice(encodeLiveNotice(notice))).toEqual(notice)
    expect(decodeLiveNotice('not json')).toBeUndefined()
    expect(decodeLiveNotice('{"t":"from.the.future","p":"p1"}')).toBeUndefined()
    expect(decodeLiveNotice('{"t":"build.updated"}')).toBeUndefined()
    expect(decodeLiveNotice('{"t":"session.ended","u":"u1"}')).toBeUndefined()
    // Rolling deploy: an older server's notice has no workspace, a newer one's may have keys this version doesn't know.
    expect(decodeLiveNotice('{"t":"build.updated","p":"p1","b":4}')).toEqual({
      type: 'build.updated',
      projectId: 'p1',
      build: 4,
    })
    expect(decodeLiveNotice('{"t":"build.updated","p":"p1","w":"w1","x":[1]}')).toEqual({
      type: 'build.updated',
      projectId: 'p1',
      workspaceId: 'w1',
    })
    expect(
      encodeLiveNotice(notices[0] ?? { type: 'triage.changed', projectId: '' }).length,
    ).toBeLessThan(200)
  })
})

describe('what a change says', () => {
  it('a new build says build.created once, with its project and number', async () => {
    const { project } = await setup()
    const live = await listenLive()
    const { build } = await startBuildUpload(t.db, {
      build: { projectId: project.id, commitSha: 'abc1234' },
      files: [],
      storageKeyFor: (s) => `files/${s}`,
    })
    expect(await live.settled()).toEqual([
      {
        type: 'build.created',
        projectId: project.id,
        workspaceId: project.workspaceId,
        build: build.number,
      },
    ])
    await live.stop()
  })

  it('a comment says comment.changed once for the build', async () => {
    const { project, owner, build } = await setup()
    const live = await listenLive()
    await addComment(t.db, { buildId: build.id, authorId: owner.id, body: 'hello' })
    expect(await live.settled()).toEqual([
      {
        type: 'comment.changed',
        projectId: project.id,
        workspaceId: project.workspaceId,
        build: build.number,
      },
    ])
    await live.stop()
  })

  it('a decision says review.changed once, however many things it touched', async () => {
    const { project, owner } = await setup()
    const build = await seedBuild(t.db, project.id, {
      status: 'complete',
      conclusion: 'changes_detected',
      changedSnapshots: ['home'],
    })
    const live = await listenLive()
    await reviewBuild(t.db, { buildId: build.id, userId: owner.id, state: 'approved' })
    expect(await live.settled()).toEqual([
      {
        type: 'review.changed',
        projectId: project.id,
        workspaceId: project.workspaceId,
        build: build.number,
      },
    ])
    await live.stop()
  })

  it('undoing a decision says review.changed for the project', async () => {
    const { project, owner } = await setup()
    const build = await seedBuild(t.db, project.id, {
      status: 'complete',
      conclusion: 'changes_detected',
      changedSnapshots: ['home'],
    })
    const { undo } = await reviewBuildUndoable(t.db, {
      buildId: build.id,
      userId: owner.id,
      state: 'approved',
      projectId: project.id,
    })
    expect(undo).not.toBeNull()
    const live = await listenLive()
    await undoAction(t.db, { id: undo?.id ?? '', userId: owner.id, projectId: project.id })
    expect(await live.settled()).toEqual([
      { type: 'review.changed', projectId: project.id, workspaceId: project.workspaceId },
    ])
    await live.stop()
  })

  it('asking for a review says review.changed for the build and notification.created for the reviewer', async () => {
    const { project, owner, ann, build } = await setup()
    const live = await listenLive()
    await requestReview(t.db, { buildId: build.id, reviewerId: ann.id, requestedById: owner.id })
    const heard = await live.settled()
    expect(heard).toHaveLength(2)
    expect(heard).toEqual(
      expect.arrayContaining([
        {
          type: 'review.changed',
          projectId: project.id,
          workspaceId: project.workspaceId,
          build: build.number,
        },
        { type: 'notification.created', userId: ann.id },
      ]),
    )
    await live.stop()
  })

  it('a notification says notification.created to its person, and reading it says notification.read', async () => {
    const { owner, ann, build } = await setup()
    const live = await listenLive()
    const notice = await notify(t.db, {
      userId: ann.id,
      kind: 'mentioned',
      buildId: build.id,
      actorId: owner.id,
      payload: {},
    })
    await markNotificationRead(t.db, { userId: ann.id, id: notice?.id ?? '', read: true })
    expect(await live.settled()).toEqual([
      { type: 'notification.created', userId: ann.id },
      { type: 'notification.read', userId: ann.id },
    ])
    await live.stop()
  })

  it('an ignore region says triage.changed for the project', async () => {
    const { project } = await setup()
    const live = await listenLive()
    await createIgnoreRegion(t.db, {
      projectId: project.id,
      name: 'home',
      x: 1,
      y: 2,
      width: 30,
      height: 4,
    })
    expect(await live.settled()).toEqual([
      { type: 'triage.changed', workspaceId: project.workspaceId, projectId: project.id },
    ])
    await live.stop()
  })
})

describe('commit and rollback', () => {
  it('says nothing when the transaction rolls back', async () => {
    const { owner, build } = await setup()
    const live = await listenLive()
    await expect(
      t.db.transaction(async (tx) => {
        await addComment(tx, { buildId: build.id, authorId: owner.id, body: 'never' })
        throw new Error('rollback')
      }),
    ).rejects.toThrow('rollback')
    expect(await live.settled()).toEqual([])
    await live.stop()
  })

  it('says nothing when a change is refused', async () => {
    const { owner, build } = await setup()
    const live = await listenLive()
    await expect(
      addComment(t.db, { buildId: build.id, authorId: owner.id, body: '   ' }),
    ).rejects.toThrow('Write something to comment')
    expect(await live.settled()).toEqual([])
    await live.stop()
  })
})

describe('access', () => {
  it('deleting a workspace tells each of its members to look at their access again, and restoring it does too', async () => {
    const { workspace, owner, ann } = await setup()
    const live = await listenLive()
    await deleteWorkspace(t.db, { workspaceId: workspace.id, userId: owner.id })
    const deleted = await live.settled()
    expect(deleted).toHaveLength(2)
    expect(deleted).toContainEqual({ type: 'access.changed', userId: owner.id })
    expect(deleted).toContainEqual({ type: 'access.changed', userId: ann.id })
    await restoreWorkspace(t.db, workspace.id)
    const all = await live.settled()
    expect(all.filter((n) => n.type === 'access.changed')).toHaveLength(4)
    await live.stop()
  })
})
