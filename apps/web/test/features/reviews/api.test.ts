import type { Review } from '@circi/api'
import { describe, expect, it } from 'vitest'

import {
  overdueLabel,
  requestCount,
  requestName,
  requestRef,
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
  reviewer: { id: 'u1', name: 'Me' },
  requestedBy: { id: 'u2', name: 'Ada Lovelace' },
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
  ...over,
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
