import { describe, expect, it } from 'vitest'

import { buildOutcome } from '../src/index.ts'

const done = { status: 'complete', conclusion: 'changes_detected', reviewStatus: 'pending' }

describe('buildOutcome (PLAN §7.4 status table)', () => {
  it.each([
    // [label, build, blockMerge, expected state]
    ['processing', { ...done, status: 'processing' }, true, 'pending'],
    ['no changes', { ...done, conclusion: 'no_changes' }, true, 'pass'],
    ['changes, pending review, blocking', done, true, 'fail'],
    ['changes, pending review, not blocking', done, false, 'pass'],
    ['approved', { ...done, reviewStatus: 'approved' }, true, 'pass'],
    ['rejected', { ...done, reviewStatus: 'rejected' }, true, 'fail'],
    ['rejected, not blocking', { ...done, reviewStatus: 'rejected' }, false, 'fail'],
    ['processing error, blocking', { ...done, status: 'error' }, true, 'fail'],
    ['processing error, not blocking', { ...done, status: 'error' }, false, 'pass'],
  ] as const)('%s → %s', (_label, build, blockMergeOnChanges, state) => {
    expect(buildOutcome({ ...build, blockMergeOnChanges }).state).toBe(state)
  })

  it('warns when passing with unreviewed changes', () => {
    expect(buildOutcome({ ...done, blockMergeOnChanges: false }).warning).toMatch(/not reviewed/)
    expect(
      buildOutcome({ ...done, conclusion: 'no_changes', blockMergeOnChanges: false }).warning,
    ).toBeUndefined()
  })
})
