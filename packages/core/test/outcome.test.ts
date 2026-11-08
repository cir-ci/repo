import { describe, expect, it } from 'vitest'

import { buildOutcome, onlyFlakyChanges, resolveFlakyBlocksMerge } from '#src/index.ts'

const flags = { flakyOnly: false, flakyBlocksMerge: true }
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
    expect(buildOutcome({ ...build, ...flags, blockMergeOnChanges }).state).toBe(state)
  })

  it('warns when passing with unreviewed changes', () => {
    expect(buildOutcome({ ...done, ...flags, blockMergeOnChanges: false }).warning).toMatch(
      /not reviewed/,
    )
    expect(
      buildOutcome({ ...done, ...flags, conclusion: 'no_changes', blockMergeOnChanges: false })
        .warning,
    ).toBeUndefined()
  })
})

describe('flaky-only changes', () => {
  const flakyOnly = { ...done, blockMergeOnChanges: true, flakyOnly: true }

  it('blocks like any other change while flaky screenshots block merges', () => {
    expect(buildOutcome({ ...flakyOnly, flakyBlocksMerge: true })).toMatchObject({
      state: 'fail',
      summary: 'Visual changes need review',
    })
  })

  it('passes, without a warning, when flaky screenshots do not block merges', () => {
    expect(buildOutcome({ ...flakyOnly, flakyBlocksMerge: false })).toEqual({
      state: 'pass',
      summary: 'Only flaky screenshots changed',
    })
  })

  it('does not excuse a change that is not only flaky', () => {
    const outcome = buildOutcome({ ...flakyOnly, flakyOnly: false, flakyBlocksMerge: false })
    expect(outcome.state).toBe('fail')
  })

  it('never overrides a rejection', () => {
    const outcome = buildOutcome({
      ...flakyOnly,
      flakyBlocksMerge: false,
      reviewStatus: 'rejected',
    })
    expect(outcome.state).toBe('fail')
  })
})

describe('resolveFlakyBlocksMerge', () => {
  it.each([
    // [org, project, effective]
    [true, null, true],
    [false, null, false],
    [true, false, false],
    [false, true, true],
    [true, true, true],
    [false, false, false],
  ] as const)('org %s, project %s → %s', (org, project, effective) => {
    expect(resolveFlakyBlocksMerge(org, project)).toBe(effective)
  })
})

describe('onlyFlakyChanges', () => {
  const counts = { added: 0, removed: 0, changed: 2, failed: 0 }
  const flaky = ['wobble', 'blink']

  it('is true when every changed screenshot is flaky', () => {
    expect(onlyFlakyChanges({ counts, changed: ['wobble', 'blink'], flaky })).toBe(true)
  })

  it('is false when one changed screenshot is not flaky', () => {
    expect(onlyFlakyChanges({ counts, changed: ['wobble', 'steady'], flaky })).toBe(false)
  })

  it.each(['added', 'removed', 'failed'] as const)('is false when something is %s', (kind) => {
    const c = { ...counts, changed: 1, [kind]: 1 }
    expect(onlyFlakyChanges({ counts: c, changed: ['wobble'], flaky })).toBe(false)
  })

  it('is false without any change', () => {
    expect(onlyFlakyChanges({ counts: { ...counts, changed: 0 }, changed: [], flaky })).toBe(false)
  })
})
