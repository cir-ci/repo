import { describe, expect, it } from 'vitest'

import { reviewability } from '#src/index.ts'

const auto = { autoApproveNoChanges: true }
const manual = { autoApproveNoChanges: false }

describe('reviewability', () => {
  it('a finished build with changes can be decided, whatever the project passes on its own', () => {
    for (const project of [auto, manual]) {
      expect(reviewability({ status: 'complete', conclusion: 'changes_detected' }, project)).toBe(
        'reviewable',
      )
    }
  })

  it('a finished build with no changes can be decided only where approval is required', () => {
    expect(reviewability({ status: 'complete', conclusion: 'no_changes' }, manual)).toBe(
      'reviewable',
    )
    expect(reviewability({ status: 'complete', conclusion: 'no_changes' }, auto)).toBe(
      'nothing_to_review',
    )
  })

  it('a build that has not finished waits, and one that broke has nothing to decide', () => {
    for (const status of ['pending', 'uploading', 'processing']) {
      expect(reviewability({ status, conclusion: null }, manual)).toBe('processing')
    }
    for (const status of ['error', 'expired']) {
      expect(reviewability({ status, conclusion: null }, manual)).toBe('failed')
    }
  })
})
