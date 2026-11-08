import type { ReviewStatus } from '@circi/api'
import type { Status } from '@circi/ui'
import { describe, expect, it } from 'vitest'

import {
  screenshotLabel,
  screenshotStatus,
  shotReview,
  type ShotKind,
} from '../../../src/features/builds/diff-status.ts'

const reviews: ReviewStatus[] = ['pending', 'approved', 'rejected']
const decided: Record<ReviewStatus, Status> = {
  pending: 'needs-review',
  approved: 'approved',
  rejected: 'rejected',
}

describe('screenshotStatus', () => {
  const cases: [ShotKind, ReviewStatus, Status][] = [
    ...reviews.map((r): [ShotKind, ReviewStatus, Status] => ['changed', r, decided[r]]),
    // Pending added and removed have their own glyph; decided ones follow the review.
    ...(['added', 'removed'] as const).flatMap((k) =>
      reviews.map((r): [ShotKind, ReviewStatus, Status] => [
        k,
        r,
        r === 'pending' ? k : decided[r],
      ]),
    ),
    ...reviews.map((r): [ShotKind, ReviewStatus, Status] => ['unchanged', r, 'neutral']),
    ...reviews.map((r): [ShotKind, ReviewStatus, Status] => ['flaky', r, 'flaky']),
    ...reviews.map((r): [ShotKind, ReviewStatus, Status] => ['failed', r, 'rejected']),
  ]
  it.each(cases)('%s in a %s build is %s', (kind, review, status) => {
    expect(screenshotStatus(kind, review)).toBe(status)
  })
})

describe('screenshotLabel', () => {
  it('is the kind while pending and for kinds that ignore the review', () => {
    expect(screenshotLabel('changed', 'pending')).toBe('Changed')
    expect(screenshotLabel('unchanged', 'approved')).toBe('Unchanged')
    expect(screenshotLabel('failed', 'rejected')).toBe('Failed')
    expect(screenshotLabel('flaky', 'approved')).toBe('Flaky')
  })
  it('adds the decision for a reviewed change', () => {
    expect(screenshotLabel('added', 'approved')).toBe('Added, approved')
    expect(screenshotLabel('removed', 'rejected')).toBe('Removed, rejected')
  })
})

describe('shotReview', () => {
  it('follows the review of a finished build only', () => {
    expect(shotReview({ status: 'complete', reviewStatus: 'approved' })).toBe('approved')
    expect(shotReview({ status: 'expired', reviewStatus: 'approved' })).toBe('pending')
    expect(shotReview({ status: 'processing', reviewStatus: 'rejected' })).toBe('pending')
  })
})
