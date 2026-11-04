import { describe, expect, it } from 'vitest'

import { type BaselineCandidate, isEligibleBaseline, resolveBaseline } from '../src/index.ts'

let seq = 0
function build(overrides: Partial<BaselineCandidate> & { commitSha: string }): BaselineCandidate {
  seq += 1
  return {
    id: `b${seq}`,
    branch: 'main',
    status: 'complete',
    reviewStatus: 'approved',
    conclusion: 'changes_detected',
    createdAt: new Date(2026, 0, 1, 0, 0, seq),
    ...overrides,
  }
}

const main = { defaultBranch: 'main' }

describe('isEligibleBaseline', () => {
  it.each([
    ['approved, changes', { reviewStatus: 'approved', conclusion: 'changes_detected' }, true],
    ['approved, no changes', { reviewStatus: 'approved', conclusion: 'no_changes' }, true],
    ['pending, no changes', { reviewStatus: 'pending', conclusion: 'no_changes' }, true],
    ['pending, changes', { reviewStatus: 'pending', conclusion: 'changes_detected' }, false],
    ['rejected, no changes', { reviewStatus: 'rejected', conclusion: 'no_changes' }, false],
    ['rejected, changes', { reviewStatus: 'rejected', conclusion: 'changes_detected' }, false],
    ['processing', { status: 'processing', reviewStatus: 'approved' }, false],
    ['error', { status: 'error', reviewStatus: 'approved' }, false],
  ] as const)('%s → %s', (_label, overrides, expected) => {
    expect(isEligibleBaseline(build({ commitSha: 'x', ...overrides }))).toBe(expected)
  })
})

describe('resolveBaseline', () => {
  it('picks the nearest ancestor with an eligible build', () => {
    const c1 = build({ commitSha: 'c1' })
    const c2 = build({ commitSha: 'c2' })
    const res = resolveBaseline({ ...main, ancestorShas: ['c3', 'c2', 'c1'] }, [c1, c2])
    expect(res).toEqual({ via: 'ancestry', build: c2, matchedCommit: 'c2' })
  })

  it('skips ancestors whose builds are not eligible', () => {
    const good = build({ commitSha: 'c1' })
    const pending = build({ commitSha: 'c2', reviewStatus: 'pending' })
    const rejected = build({ commitSha: 'c3', reviewStatus: 'rejected', conclusion: 'no_changes' })
    const res = resolveBaseline({ ...main, ancestorShas: ['c3', 'c2', 'c1'] }, [
      good,
      pending,
      rejected,
    ])
    expect(res).toMatchObject({ via: 'ancestry', build: good })
  })

  it('treats a no-change build as a baseline even without approval', () => {
    const noChanges = build({ commitSha: 'c2', reviewStatus: 'pending', conclusion: 'no_changes' })
    const older = build({ commitSha: 'c1' })
    expect(
      resolveBaseline({ ...main, ancestorShas: ['c2', 'c1'] }, [older, noChanges]),
    ).toMatchObject({ via: 'ancestry', build: noChanges })
  })

  it('takes the newest build when a commit has several (CI re-runs)', () => {
    const first = build({ commitSha: 'c1' })
    const rerun = build({ commitSha: 'c1' })
    const res = resolveBaseline({ ...main, ancestorShas: ['c1'] }, [rerun, first])
    expect(res).toMatchObject({ build: rerun })
  })

  it('falls back to the latest eligible default-branch build when no ancestor matches', () => {
    const oldMain = build({ commitSha: 'm1' })
    const newMain = build({ commitSha: 'm2' })
    const feature = build({ commitSha: 'f1', branch: 'feature' })
    const res = resolveBaseline({ ...main, ancestorShas: ['zzz'] }, [oldMain, newMain, feature])
    expect(res).toEqual({ via: 'fallback', build: newMain })
  })

  it('falls back when ancestry is missing entirely', () => {
    const m = build({ commitSha: 'm1' })
    expect(resolveBaseline({ ...main, ancestorShas: [] }, [m])).toEqual({
      via: 'fallback',
      build: m,
    })
  })

  it('never falls back to a build from another branch', () => {
    const feature = build({ commitSha: 'f1', branch: 'feature' })
    expect(resolveBaseline({ ...main, ancestorShas: [] }, [feature])).toEqual({ via: 'none' })
  })

  it('ignores fallback candidates that are not eligible', () => {
    const pending = build({ commitSha: 'm1', reviewStatus: 'pending' })
    expect(resolveBaseline({ ...main, ancestorShas: [] }, [pending])).toEqual({ via: 'none' })
  })

  it('returns none for an orphan build (first build of a project)', () => {
    expect(resolveBaseline({ ...main, ancestorShas: ['a', 'b'] }, [])).toEqual({ via: 'none' })
  })

  it('prefers ancestry over a newer default-branch build', () => {
    // PR forked from m1; main has since moved on to m2. The PR must compare against m1,
    // or unrelated changes merged into main would show up as the PR's diff.
    const m1 = build({ commitSha: 'm1' })
    const m2 = build({ commitSha: 'm2' })
    const res = resolveBaseline({ ...main, ancestorShas: ['m1', 'm0'] }, [m1, m2])
    expect(res).toMatchObject({ via: 'ancestry', build: m1 })
  })
})
