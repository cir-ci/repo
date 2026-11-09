import type { Inbox } from '@circi/api'
import { describe, expect, it } from 'vitest'

import {
  inboxCount,
  notificationName,
  notificationTarget,
  notificationText,
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
  actor: { id: 'u2', name: 'Ada' },
  build: { number: 12, branch: 'main', prNumber: null, commitSha: 'abcdef1234567' },
  team: { slug: 'web', name: 'Web' },
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
      'Web’s git connection needs attention',
    )
    expect(title('flaky_detected', { build: null, actor: null })).toBe(
      'Flaky screenshots found in Web',
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

  it('says "Someone" when the person has left', () => {
    expect(notificationText(item({ actor: null })).title).toBe(
      'Someone requested your review of build #12',
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

  it('opens the build, else the team, else nothing', () => {
    expect(notificationTarget(item())).toEqual({
      to: '/$workspace/$team/builds/$number',
      params: { workspace: 'acme', team: 'web', number: '12' },
    })
    expect(notificationTarget(item({ build: null }))).toEqual({
      to: '/$workspace/$team',
      params: { workspace: 'acme', team: 'web' },
    })
    expect(notificationTarget(item({ build: null, team: null, workspace: null }))).toBeUndefined()
  })

  it('opens a mention on the Comments tab, at its comment', () => {
    expect(
      notificationTarget(item({ kind: 'mentioned', payload: { commentId: 'c9', snippet: 'hi' } })),
    ).toEqual({
      to: '/$workspace/$team/builds/$number',
      params: { workspace: 'acme', team: 'web', number: '12' },
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
