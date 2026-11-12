import type { Inbox } from '@circi/api'
import { describe, expect, it } from 'vitest'

import {
  awaitsYourReview,
  inboxCount,
  inboxTabs,
  notificationName,
  notificationTarget,
  notificationText,
  openLabel,
  replyTarget,
  snoozeBody,
  validateInboxSearch,
} from '#features/inbox/api.ts'

const item = (over: Partial<Inbox.Item> = {}): Inbox.Item => ({
  id: 'n1',
  kind: 'review_requested',
  createdAt: '2026-11-08T10:00:00.000Z',
  readAt: null,
  snoozedUntil: null,
  payload: {},
  actor: { id: 'u2', name: 'Ada', image: null },
  build: {
    number: 12,
    name: 'default',
    branch: 'main',
    prNumber: null,
    commitSha: 'abcdef1234567',
    status: 'complete',
    reviewStatus: 'pending',
  },
  changes: { changed: 4, added: 1, removed: 0, unchanged: 38, failed: 0 },
  request: { dueAt: null, overdueByMs: 0 },
  project: { slug: 'web', name: 'Web' },
  workspace: { slug: 'acme', name: 'Acme' },
  alsoInReviews: false,
  ...over,
})

const title = (kind: Inbox.Item['kind'], over: Partial<Inbox.Item> = {}) =>
  notificationText(item({ kind, ...over })).title

describe('notificationText', () => {
  it('words each kind', () => {
    expect(title('review_requested')).toBe('Ada requested your review of build #12')
    expect(title('review_re_requested')).toBe('Ada asked you to review build #12 again')
    expect(title('mentioned')).toBe('Ada mentioned you on build #12')
    expect(title('build_approved')).toBe('Ada approved build #12')
    expect(title('build_rejected')).toBe('Ada rejected build #12')
    expect(title('review_overdue', { actor: null })).toBe('Your review of build #12 is overdue')
    expect(title('connection_needs_attention', { build: null })).toBe(
      "Web's git connection needs attention",
    )
    expect(title('flaky_detected', { build: null, actor: null })).toBe(
      'Flaky screenshot found in Web',
    )
  })

  it('shows the rejection reason and the mention snippet, not blanks', () => {
    expect(
      notificationText(item({ kind: 'build_rejected', payload: { reason: ' Logo moved ' } }))
        .detail,
    ).toBe('Logo moved')
    expect(
      notificationText(item({ kind: 'mentioned', payload: { snippet: 'take a look' } })).detail,
    ).toBe('take a look')
    expect(
      notificationText(item({ kind: 'build_rejected', payload: { reason: '  ' } })).detail,
    ).toBeUndefined()
  })

  it('says what happened when no person is behind a review request', () => {
    expect(notificationText(item({ actor: null })).title).toBe(
      'A review rule asked you to review build #12',
    )
    expect(notificationText(item({ actor: null, kind: 'review_re_requested' })).title).toBe(
      'A review rule asked you to review build #12 again',
    )
  })
})

describe('notification rows', () => {
  it('names an unread row first', () => {
    expect(notificationName(item())).toBe('Unread, Ada requested your review of build #12, Web')
    expect(notificationName(item({ readAt: '2026-11-08T11:00:00.000Z' }))).toBe(
      'Ada requested your review of build #12, Web',
    )
  })

  it('counts and counts unread', () => {
    expect(inboxCount([])).toBe('0 notifications')
    expect(inboxCount([item({ readAt: 'x' })])).toBe('1 notification')
    expect(inboxCount([item(), item({ readAt: 'x' }), item()])).toBe('3 notifications, 2 unread')
  })

  it('opens the build, else the project, else nothing', () => {
    expect(notificationTarget(item())).toEqual({
      to: '/$workspace/$project/builds/$number',
      params: { workspace: 'acme', project: 'web', number: '12' },
    })
    expect(notificationTarget(item({ build: null }))).toEqual({
      to: '/$workspace/$project',
      params: { workspace: 'acme', project: 'web' },
    })
    expect(
      notificationTarget(item({ build: null, project: null, workspace: null })),
    ).toBeUndefined()
  })

  it('opens a mention on the Comments tab, at its comment', () => {
    expect(
      notificationTarget(item({ kind: 'mentioned', payload: { commentId: 'c9', snippet: 'hi' } })),
    ).toEqual({
      to: '/$workspace/$project/builds/$number',
      params: { workspace: 'acme', project: 'web', number: '12' },
      search: { sidebar: 'comments', comment: 'c9' },
    })
    // Without a comment id (an older notice) it is the plain build.
    expect(notificationTarget(item({ kind: 'mentioned' }))).not.toHaveProperty('search')
  })
})

describe('inbox tabs and snoozing', () => {
  it('keeps a known tab and falls back to For you', () => {
    expect(validateInboxSearch({ tab: 'everything' })).toEqual({ tab: 'everything' })
    expect(validateInboxSearch({ tab: 'snoozed' })).toEqual({ tab: 'snoozed' })
    expect(validateInboxSearch({ tab: 'x' })).toEqual({ tab: 'for-you' })
  })

  it('snoozes to a time only', () => {
    expect(snoozeBody({ kind: 'tomorrow' })).toEqual({ choice: 'tomorrow' })
    expect(snoozeBody({ kind: 'next_week' })).toEqual({ choice: 'next_week' })
    expect(snoozeBody({ kind: 'date', date: '2026-12-01T09:00:00.000Z' })).toEqual({
      choice: 'date',
      date: '2026-12-01T09:00:00.000Z',
    })
    expect(snoozeBody({ kind: 'next_push' })).toEqual({ choice: 'tomorrow' })
  })
})

describe('the pane', () => {
  it('offers Approve all only while the build waits for your review', () => {
    expect(awaitsYourReview(item())).toBe(true)
    expect(awaitsYourReview(item({ request: null }))).toBe(false)
    const decided = item().build
    expect(
      awaitsYourReview(item({ build: decided && { ...decided, reviewStatus: 'approved' } })),
    ).toBe(false)
    expect(awaitsYourReview(item({ build: null }))).toBe(false)
  })

  it('replies only to a mention that names its comment', () => {
    expect(replyTarget(item({ kind: 'mentioned', payload: { commentId: 'c1' } }))).toBe('c1')
    expect(replyTarget(item({ kind: 'mentioned' }))).toBeUndefined()
    expect(replyTarget(item({ payload: { commentId: 'c1' } }))).toBeUndefined()
  })

  it('names the Open button for what it opens', () => {
    expect(openLabel(item())).toBe('Open review')
    expect(openLabel(item({ kind: 'mentioned' }))).toBe('Open thread')
    expect(openLabel(item({ kind: 'build_rejected' }))).toBe('Open build')
    expect(openLabel(item({ kind: 'connection_needs_attention', build: null }))).toBe(
      'Open project',
    )
  })

  it('counts the Snoozed tab only when something is snoozed', () => {
    expect(inboxTabs(0).map((t) => t.label)).toEqual(['For you', 'Everything', 'Snoozed'])
    expect(inboxTabs(3).map((t) => t.label)).toEqual(['For you', 'Everything', 'Snoozed 3'])
  })
})
