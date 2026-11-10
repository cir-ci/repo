import type { Activity, Comment } from '@circi/api'
import { describe, expect, it } from 'vitest'

import { commentCount, groupThreads, timelineItems } from '#features/builds/timeline.ts'

const at = '2026-11-08T10:00:00.000Z'
const person = { id: 'u1', name: 'Ada Lovelace', image: null }

describe('timelineItems: issues', () => {
  it('says who created which issue, for which snapshot, and quotes its title', () => {
    const [item] = timelineItems([
      {
        type: 'issue_created',
        at,
        issue: {
          key: 'WEB-9',
          url: 'https://x.test/WEB-9',
          title: 'Header broke',
          tracker: 'jira',
        },
        snapshotName: 'home',
        by: person,
      },
    ])
    expect(item).toMatchObject({
      actor: person,
      text: 'created issue WEB-9 for home',
      quote: 'Header broke',
    })
  })
})

describe('timelineItems', () => {
  it("describes each kind of event, keeping a rejection's reason as a quote", () => {
    const events: Activity.Event[] = [
      { type: 'uploaded', at },
      { type: 'failed', at, message: 'out of memory' },
      {
        type: 'review_requested',
        at,
        reviewer: { id: 'u2', name: 'Grace', image: null },
        by: person,
      },
      { type: 'review_requested', at, reviewer: null, by: null },
      {
        type: 'review_request_closed',
        at,
        reviewer: { id: 'u2', name: 'Grace', image: null },
        state: 'done',
      },
      { type: 'review', at, state: 'rejected', source: 'ui', reason: 'Too blue', by: person },
      { type: 'review', at, state: 'approved', source: 'auto', reason: null, by: null },
      { type: 'review', at, state: 'rejected', source: 'rerun', reason: null, by: null },
      {
        type: 'comment',
        at,
        commentId: 'c1',
        parentId: 'c0',
        snapshotName: 'home',
        body: 'x'.repeat(300),
        by: person,
      },
    ]
    const items = timelineItems(events)
    expect(items.map((i) => i.text)).toEqual([
      'Build uploaded',
      'Build failed',
      'requested Grace to review',
      'Review requested from someone who has left',
      'Review request for Grace was answered',
      'rejected the build',
      'Approved automatically: a build on the default branch',
      'Rejected automatically: an earlier build of this commit, with the same screenshots, was rejected',
      'replied on home',
    ])
    expect(items[1]?.quote).toBe('out of memory')
    expect(items[1]?.status).toBe('rejected')
    expect(items[5]).toMatchObject({ status: 'rejected', actor: person, quote: 'Too blue' })
    // Automatic decisions have no actor.
    expect(items[6]).toMatchObject({ status: 'approved', actor: null })
    expect(items[7]).toMatchObject({ status: 'rejected', actor: null })
    // A long comment is cut, and links back to its comment.
    expect(items[8]?.quote?.length).toBe(140)
    expect(items[8]?.commentId).toBe('c1')
    expect(new Set(items.map((i) => i.key)).size).toBe(items.length)
  })
})

const comment = (id: string, over: Partial<Comment.Item> = {}): Comment.Item => ({
  id,
  parentId: null,
  snapshotName: null,
  region: null,
  regionSide: 'current',
  body: id,
  author: person,
  createdAt: at,
  editedAt: null,
  deletedAt: null,
  mine: false,
  canDelete: false,
  ...over,
})

describe('groupThreads', () => {
  it('nests replies under their comment in order', () => {
    const threads = groupThreads([
      comment('a'),
      comment('b'),
      comment('a1', { parentId: 'a' }),
      comment('a2', { parentId: 'a' }),
    ])
    expect(threads.map((t) => [t.root.id, t.replies.map((r) => r.id)])).toEqual([
      ['a', ['a1', 'a2']],
      ['b', []],
    ])
  })

  it('keeps a deleted comment only while it has replies', () => {
    const deleted = { deletedAt: at, body: '' }
    const threads = groupThreads([
      comment('a', deleted),
      comment('a1', { parentId: 'a' }),
      comment('b', deleted),
      comment('c1', { parentId: 'c' }),
    ])
    expect(threads.map((t) => t.root.id)).toEqual(['a'])
  })

  it('counts comments that still exist', () => {
    expect(commentCount([comment('a'), comment('b', { deletedAt: at })])).toBe(1)
  })
})

const SNAPSHOT_AT = '2026-03-01T10:00:00.000Z'

describe('timelineItems: snapshot decisions', () => {
  it('names one snapshot, and groups several into one line', () => {
    const items = timelineItems([
      {
        type: 'snapshot_review',
        at: SNAPSHOT_AT,
        decision: 'rejected',
        snapshotNames: ['home'],
        reason: 'wrong red',
        by: { id: 'u1', name: 'Ada', image: null },
      },
      {
        type: 'snapshot_review',
        at: SNAPSHOT_AT,
        decision: 'approved',
        snapshotNames: ['a', 'b', 'c'],
        reason: null,
        by: { id: 'u1', name: 'Ada', image: null },
      },
    ])
    expect(items).toMatchObject([
      {
        status: 'rejected',
        actor: { id: 'u1', name: 'Ada', image: null },
        text: 'rejected home',
        quote: 'wrong red',
      },
      {
        status: 'approved',
        actor: { id: 'u1', name: 'Ada', image: null },
        text: 'approved 3 screenshots',
        quote: 'a, b, c',
      },
    ])
  })
})
