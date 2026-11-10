import { describe, expect, it } from 'vitest'

import { type BuildState, buildState, screenState } from '#features/builds/build-state.ts'

const state = (over: Partial<BuildState.Input>) =>
  buildState({
    status: 'complete',
    conclusion: 'changes_detected',
    reviewStatus: 'pending',
    ...over,
  })

describe('buildState', () => {
  it("names each stage of a build's life", () => {
    expect(state({ status: 'processing', conclusion: null }).label).toMatch(/process/i)
    expect(state({ status: 'error', conclusion: null }).tone).toBe('danger')
    expect(state({ conclusion: 'no_changes' }).label).toMatch(/no changes/i)
    expect(state({}).label).toMatch(/review/i)
    expect(state({ reviewStatus: 'approved' }).label).toMatch(/approved/i)
    expect(state({ reviewStatus: 'rejected' }).label).toMatch(/rejected/i)
  })

  it('has a kind for each state', () => {
    expect(state({ status: 'uploading', conclusion: null }).kind).toBe('uploading')
    expect(state({ status: 'expired', conclusion: null }).kind).toBe('expired')
    expect(state({ reviewStatus: 'rejected' }).kind).toBe('rejected')
    expect(state({ status: 'error', conclusion: null }).kind).toBe('failed')
  })

  it('tells a failed build (crimson cross) from a rejected one (a person decided: rose, barred)', () => {
    const failed = state({ status: 'error', conclusion: null })
    const rejected = state({ reviewStatus: 'rejected' })
    expect(failed).toMatchObject({ status: 'failed', tone: 'danger' })
    expect(rejected).toMatchObject({ status: 'rejected', tone: 'rejected' })
    expect(failed.status).not.toBe(rejected.status)
  })
})

describe('buildState status (docs/design-gaps.md §8)', () => {
  it.each([
    [{ status: 'uploading', conclusion: null }, 'processing', 'Uploading'],
    [{ status: 'pending', conclusion: null }, 'processing', 'Uploading'],
    [{ status: 'processing', conclusion: null }, 'processing', 'Processing'],
    [{}, 'needs-review', 'Needs review'],
    [{ reviewStatus: 'approved' }, 'approved', 'Approved'],
    [{ reviewStatus: 'rejected' }, 'rejected', 'Rejected'],
    [{ conclusion: 'no_changes' }, 'approved', 'No changes'],
    [{ status: 'error', conclusion: null }, 'failed', 'Failed'],
    [{ status: 'expired', conclusion: null }, 'neutral', 'Expired'],
  ] as const)('%j is %s, "%s"', (over, status, label) => {
    expect(state(over)).toMatchObject({ status, label })
  })
})

describe('screenState', () => {
  const review: BuildState.Input = {
    status: 'complete',
    conclusion: 'changes_detected',
    reviewStatus: 'pending',
  }

  it('calls a build with changes and nothing to compare against "No baseline"', () => {
    expect(screenState(review, false)).toEqual({
      kind: 'orphan',
      label: 'No baseline',
      status: 'neutral',
    })
  })

  it('leaves a build with a baseline, or one already decided, as it is', () => {
    expect(screenState(review, true).kind).toBe('review')
    expect(screenState({ ...review, reviewStatus: 'approved' }, false).kind).toBe('approved')
  })
})
