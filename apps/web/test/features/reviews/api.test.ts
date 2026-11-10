import type { Review } from '@circi/api'
import { describe, expect, it } from 'vitest'

import {
  changeSummary,
  baselineLabel,
  decisionLabel,
  groupRequests,
  reasonLabel,
  overdueLabel,
  requestCount,
  requestName,
  requestRef,
  requestStatus,
  scoreLabel,
  snoozedLabel,
  validateReviewsSearch,
} from '#features/reviews/api.ts'
import { nextAfterRemoval } from '#lib/list-keys.ts'

const request = (over: Partial<Review.Request> = {}): Review.Request => ({
  id: 'r1',
  state: 'open',
  createdAt: '2026-11-08T10:00:00.000Z',
  dueAt: null,
  overdueByMs: 0,
  snoozedUntil: null,
  snoozeKind: null,
  closedAt: null,
  decision: null,
  reason: null,
  baseline: { number: 11, branch: 'main' },
  reviewer: { id: 'u1', name: 'Me', image: null },
  requestedBy: { id: 'u2', name: 'Ada Lovelace', image: null },
  build: {
    number: 12,
    branch: 'main',
    prNumber: null,
    commitSha: 'abcdef1234567',
    status: 'complete',
    conclusion: 'changes_detected',
    reviewStatus: 'pending',
  },
  team: { slug: 'web', name: 'Web' },
  workspace: { slug: 'acme', name: 'Acme' },
  changes: { changed: 2, added: 1, removed: 0, unchanged: 5 },
  largestChanges: [],
  ...over,
})

describe('snoozedLabel', () => {
  const now = Date.parse('2026-11-09T09:00:00.000Z')
  const after = (ms: number) => new Date(now + ms).toISOString()

  it('says how long a request is put off, never "Until in …"', () => {
    expect(snoozedLabel(after(18 * 3600_000), now)).toBe('Snoozed for 18 hours')
    expect(snoozedLabel(after(3600_000), now)).toBe('Snoozed for 1 hour')
    expect(snoozedLabel(after(25 * 60_000), now)).toBe('Snoozed for 25 minutes')
    expect(snoozedLabel(after(3 * 24 * 3600_000), now)).toBe('Snoozed for 3 days')
  })

  it('says only "Snoozed" once the time has come', () => {
    expect(snoozedLabel(after(-1000), now)).toBe('Snoozed')
  })
})

describe('overdueLabel', () => {
  it('says nothing for a request on time', () => {
    expect(overdueLabel(0)).toBeUndefined()
    expect(overdueLabel(-5)).toBeUndefined()
  })

  it('counts minutes, hours and days, rounding down', () => {
    expect(overdueLabel(30_000)).toBe('Overdue 1m')
    expect(overdueLabel(25 * 60_000)).toBe('Overdue 25m')
    expect(overdueLabel(3 * 3600_000 + 59 * 60_000)).toBe('Overdue 3h')
    expect(overdueLabel(2 * 24 * 3600_000 + 5 * 3600_000)).toBe('Overdue 2d')
  })
})

describe('request labels', () => {
  it('shows the branch, else the pull request, else the short commit', () => {
    const build = request().build
    expect(requestRef(build)).toBe('main')
    expect(requestRef({ ...build, branch: null, prNumber: 7 })).toBe('PR #7')
    expect(requestRef({ ...build, branch: null, prNumber: null })).toBe('abcdef1')
  })

  it('names a row for screen readers', () => {
    expect(requestName(request({ overdueByMs: 3 * 3600_000 }))).toBe(
      'Build 12 of Web on main, asked by Ada Lovelace, overdue 3h',
    )
    expect(requestName(request({ requestedBy: null }))).toBe('Build 12 of Web on main')
  })

  it('counts', () => {
    expect(requestCount(1)).toBe('1 review')
    expect(requestCount(3)).toBe('3 reviews')
  })
})

describe('validateReviewsSearch', () => {
  it('keeps a known tab and falls back to For you', () => {
    expect(validateReviewsSearch({ tab: 'snoozed' })).toEqual({ tab: 'snoozed' })
    expect(validateReviewsSearch({ tab: 'created' })).toEqual({ tab: 'created' })
    expect(validateReviewsSearch({ tab: 'nope' })).toEqual({ tab: 'for-you' })
    expect(validateReviewsSearch({})).toEqual({ tab: 'for-you' })
  })

  it('keeps the selected review', () => {
    expect(validateReviewsSearch({ review: 'r1' })).toEqual({ tab: 'for-you', review: 'r1' })
    expect(validateReviewsSearch({ review: '' })).toEqual({ tab: 'for-you' })
    expect(validateReviewsSearch({ review: 5 })).toEqual({ tab: 'for-you' })
  })
})

describe('nextAfterRemoval', () => {
  const ids = ['a', 'b', 'c']
  const next = (id: string, items = ids) => nextAfterRemoval(items, (x) => x, id)

  it('moves to the item after, else the one before', () => {
    expect(next('a')).toBe('b')
    expect(next('b')).toBe('c')
    expect(next('c')).toBe('b')
  })

  it('has none for the only item or an unknown one', () => {
    expect(next('a', ['a'])).toBeUndefined()
    expect(next('zzz')).toBeUndefined()
  })
})

describe('groupRequests', () => {
  const processing = request({ id: 'r2', build: { ...request().build, status: 'processing' } })

  it('splits what needs review from what is still processing', () => {
    const groups = groupRequests([request(), processing], 'for-you')
    expect(groups.map((g) => [g.label, g.items.map((r) => r.id)])).toEqual([
      ['Needs your review', ['r1']],
      ['Still processing', ['r2']],
    ])
  })

  it('has one group on the other tabs, and none when empty', () => {
    expect(groupRequests([request()], 'created').map((g) => g.label)).toEqual([
      'Waiting on reviewers',
    ])
    expect(groupRequests([request()], 'snoozed').map((g) => g.label)).toEqual(['Snoozed'])
    expect(groupRequests([], 'for-you')).toEqual([])
  })

  it('puts re-requested reviews in their own group, and splits All open by who was asked', () => {
    const again = request({ id: 'r3', reason: { kind: 're_requested' } })
    expect(groupRequests([request(), again], 'for-you').map((g) => g.label)).toEqual([
      'Needs your review',
      'Re-requested',
    ])
    const theirs = request({ id: 'r4', reviewer: { id: 'u9', name: 'Dana', image: null } })
    expect(
      groupRequests([request(), theirs, processing], 'all-open', 'u1').map((g) => [
        g.label,
        g.items.map((r) => r.id),
      ]),
    ).toEqual([
      ['Requested from you', ['r1']],
      ['Requested from others', ['r4']],
      ['Still processing', ['r2']],
    ])
    expect(groupRequests([request()], 'reviewed').map((g) => g.label)).toEqual(['Reviewed by you'])
  })

  it('words the reason chip, the decision and the baseline', () => {
    const back = request({ reason: { kind: 'rejected_earlier', buildNumber: 143 } })
    expect(reasonLabel(back, 'u1')).toBe('You rejected #143')
    expect(reasonLabel(back, 'u2')).toBe('Me rejected #143')
    expect(reasonLabel(request({ reason: { kind: 're_requested' } }))).toBe('Re-requested')
    expect(reasonLabel(request())).toBeUndefined()
    expect(decisionLabel(request({ decision: 'rejected' }))).toBe('Rejected by you')
    expect(decisionLabel(request())).toBeUndefined()
    expect(baselineLabel(request())).toBe('#11 · main')
    expect(baselineLabel(request({ baseline: null }))).toBeUndefined()
  })

  it('gives each request its status', () => {
    expect(requestStatus(request())).toEqual({ status: 'needs-review', label: 'Needs review' })
    expect(requestStatus(processing).status).toBe('processing')
    expect(
      requestStatus(request({ build: { ...request().build, reviewStatus: 'approved' } })).status,
    ).toBe('approved')
  })
})

describe('change summary', () => {
  it('lists the kinds that have screenshots', () => {
    expect(changeSummary({ changed: 4, added: 1, removed: 0, unchanged: 3 })).toEqual([
      '4 changed',
      '1 added',
    ])
    expect(changeSummary({ changed: 0, added: 0, removed: 0, unchanged: 3 })).toEqual([])
  })

  it('writes a diff score as a percentage', () => {
    expect(scoreLabel(0.024)).toBe('2.4%')
    expect(scoreLabel(0.0001)).toBe('<0.1%')
    expect(scoreLabel(0)).toBe('0%')
    expect(scoreLabel(null)).toBe('')
  })
})
