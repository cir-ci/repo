import { describe, expect, it } from 'vitest'

import { buildOutcome, resolveFlakyBlocksMerge } from '#src/index.ts'

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
      /aren't reviewed/,
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

  it("passes, without a warning, when flaky screenshots don't block merges", () => {
    expect(buildOutcome({ ...flakyOnly, flakyBlocksMerge: false })).toEqual({
      state: 'pass',
      summary: 'Only flaky screenshots changed',
    })
  })

  it("doesn't excuse a change that isn't only flaky", () => {
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

describe('buildOutcome with unreadable screenshots', () => {
  it.each([
    ['approved', { reviewStatus: 'approved' }],
    ['pending', {}],
  ] as const)('fails a project that blocks merges, even %s', (_label, over) => {
    expect(
      buildOutcome({ ...done, ...flags, ...over, blockMergeOnChanges: true, unreadable: 2 }),
    ).toEqual({ state: 'fail', summary: "2 screenshots couldn't be read" })
  })

  it.each([
    ['approved', { reviewStatus: 'approved' }],
    ['pending', {}],
  ] as const)(
    "passes with a warning in a project that doesn't block merges (%s), like a failed build",
    (_label, over) => {
      expect(
        buildOutcome({ ...done, ...flags, ...over, blockMergeOnChanges: false, unreadable: 2 }),
      ).toEqual({
        state: 'pass',
        summary: "2 screenshots couldn't be read",
        warning: "2 screenshots couldn't be read; merges aren't blocked for this project",
      })
    },
  )

  it('names one screenshot in the singular', () => {
    expect(
      buildOutcome({ ...done, ...flags, blockMergeOnChanges: true, unreadable: 1 }).summary,
    ).toBe("1 screenshot couldn't be read")
  })
})

describe('resolveFlakyBlocksMerge', () => {
  it.each([
    // [workspace, project, effective]
    [true, null, true],
    [false, null, false],
    [true, false, false],
    [false, true, true],
    [true, true, true],
    [false, false, false],
  ] as const)('workspace %s, project %s → %s', (workspace, project, effective) => {
    expect(resolveFlakyBlocksMerge(workspace, project)).toBe(effective)
  })
})
