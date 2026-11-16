import type { Build, Comment } from '@circi/api'
import { describe, expect, it } from 'vitest'

import {
  pendingComment,
  withComment,
  withDeletedComment,
  withEditedComment,
} from '#features/builds/api/comments-optimistic.ts'
import { withBuildDecision, withSnapshotDecisions } from '#features/builds/api/optimistic.ts'
import { projectInfo } from '#test/support/fixtures.ts'

const now = new Date('2026-11-16T10:00:00.000Z')
const ada = { id: 'u1', name: 'Ada' }

const shot = (name: string, status: Build.DiffItem['status']): Build.DiffItem => ({
  id: name,
  name,
  status,
  score: null,
  changedPixels: null,
  sizeChanged: false,
  errorMessage: null,
  head: null,
  base: null,
  diff: null,
  review: null,
})

function detail(diffs: Build.DiffItem[] = []): Build.Detail {
  return {
    project: projectInfo({ slug: 'web-app', name: 'web-app', workspaceName: 'Acme' }),
    build: {
      id: 'b7',
      number: 7,
      name: 'default',
      commitSha: '0123456789abcdef',
      branch: 'main',
      prNumber: null,
      status: 'complete',
      conclusion: 'changes_detected',
      reviewStatus: 'pending',
      createdAt: now.toISOString(),
      counts: { added: 0, removed: 0, changed: 2, unchanged: 1, failed: 0, total: 3 },
      author: null,
      baseBranch: 'main',
      ancestryStatus: 'ok',
      baselineSource: 'provider',
      errorMessage: null,
      completedAt: null,
    },
    baseline: null,
    reviews: [],
    diffs,
    issues: [],
    reviewTarget: { hours: null, dueAt: null },
    authorUserId: null,
    watchers: [],
    pullRequest: null,
  }
}

const build = () => detail([shot('a', 'changed'), shot('b', 'changed'), shot('c', 'unchanged')])

describe('withSnapshotDecisions', () => {
  it('marks the named screenshots and keeps the build pending while others wait', () => {
    const next = withSnapshotDecisions(build(), ['a'], 'approved', null, ada, now)
    expect(next.diffs[0]?.review).toEqual({
      decision: 'approved',
      reviewer: ada,
      at: now.toISOString(),
      reason: null,
    })
    expect(next.diffs[1]?.review).toBeNull()
    expect(next.build.reviewStatus).toBe('pending')
  })

  it('approves the build once every changed screenshot is approved', () => {
    const next = withSnapshotDecisions(build(), 'undecided', 'approved', null, ada, now)
    expect(next.diffs[2]?.review).toBeNull()
    expect(next.build.reviewStatus).toBe('approved')
  })

  it('rejects the build on one rejection, with the reason', () => {
    const next = withSnapshotDecisions(build(), ['b'], 'rejected', 'Logo moved', ada, now)
    expect(next.diffs[1]?.review?.reason).toBe('Logo moved')
    expect(next.build.reviewStatus).toBe('rejected')
  })

  it('does not decide an unchanged screenshot, and leaves the input alone', () => {
    const before = build()
    const next = withSnapshotDecisions(before, ['c'], 'approved', null, null, now)
    expect(next.diffs[2]?.review).toBeNull()
    expect(before.build.reviewStatus).toBe('pending')
  })
})

describe('withBuildDecision', () => {
  it('sets the whole build', () => {
    expect(withBuildDecision(detail(), 'rejected').build.reviewStatus).toBe('rejected')
  })
})

describe('comments', () => {
  const existing: Comment.Item = pendingComment({ body: 'first' }, null, 'c1', now)

  it('shapes a pending comment from its input and the signed-in author', () => {
    const c = pendingComment(
      { body: 'hi', snapshotName: 'a', parentId: 'c1' },
      { id: 'u1', name: 'Ada', image: null },
      'pending-1',
      now,
    )
    expect(c).toMatchObject({
      id: 'pending-1',
      parentId: 'c1',
      snapshotName: 'a',
      regionSide: 'current',
      mine: true,
      body: 'hi',
    })
  })

  it('appends, edits and deletes', () => {
    const added = withComment(
      { comments: [existing] },
      pendingComment({ body: 'two' }, null, 'p', now),
    )
    expect(added.comments.map((c) => c.id)).toEqual(['c1', 'p'])
    expect(withEditedComment(added, 'p', 'three', now).comments[1]?.body).toBe('three')
    const gone = withDeletedComment(added, 'c1', now).comments[0]
    expect(gone).toMatchObject({ body: '', deletedAt: now.toISOString() })
  })
})
