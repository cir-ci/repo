import { describe, expect, it } from 'vitest'

import { deriveReviewStatus } from '#src/index.ts'

const d = (...e: [string, 'approved' | 'rejected'][]) => new Map(e)

describe('deriveReviewStatus', () => {
  it('is approved when every changed snapshot is approved', () => {
    expect(
      deriveReviewStatus({
        changed: ['a', 'b'],
        decisions: d(['a', 'approved'], ['b', 'approved']),
      }),
    ).toBe('approved')
  })
  it('is rejected when any snapshot is rejected', () => {
    expect(
      deriveReviewStatus({
        changed: ['a', 'b'],
        decisions: d(['a', 'approved'], ['b', 'rejected']),
      }),
    ).toBe('rejected')
    expect(deriveReviewStatus({ changed: ['a', 'b'], decisions: d(['b', 'rejected']) })).toBe(
      'rejected',
    )
  })
  it('is pending while some changed snapshot is undecided', () => {
    expect(deriveReviewStatus({ changed: ['a', 'b'], decisions: d(['a', 'approved']) })).toBe(
      'pending',
    )
  })
  it('is pending with nothing changed', () => {
    expect(deriveReviewStatus({ changed: [], decisions: d() })).toBe('pending')
  })
  it('ignores decisions on snapshots that are not changed', () => {
    expect(
      deriveReviewStatus({ changed: ['a'], decisions: d(['a', 'approved'], ['x', 'rejected']) }),
    ).toBe('approved')
  })
})
