import type { Build } from '@circi/api'
import { describe, expect, it } from 'vitest'

import {
  changeSummary,
  defaultShot,
  formatPercent,
  groupShots,
  isReviewable,
  needsDecision,
  neighbour,
  orderShots,
  reviewProgress,
  reviewTargetStatus,
  shotBadge,
  shotKind,
  undecidedNames,
} from '#features/builds/review-model.ts'

let id = 0
const diff = (name: string, status: Build.DiffItem['status'], over: Partial<Build.DiffItem> = {}) =>
  ({
    id: `d${++id}`,
    name,
    status,
    score: null,
    changedPixels: null,
    sizeChanged: false,
    errorMessage: null,
    head: null,
    base: null,
    diff: null,
    review: null,
    ...over,
  }) satisfies Build.DiffItem

const diffs = [
  diff('a-unchanged', 'unchanged'),
  diff('b-changed', 'changed', { score: 0.0042 }),
  diff('c-added', 'added'),
  diff('d-removed', 'removed'),
  diff('e-failed', 'failed'),
  diff('f-changed', 'changed', { score: 0.2 }),
  diff('g-pending', null),
]

describe('groupShots', () => {
  it('orders groups Changed, Added, Removed, Flaky, Failed, Unchanged and drops empty ones', () => {
    expect(groupShots(diffs).map((g) => g.kind)).toEqual([
      'changed',
      'added',
      'removed',
      'failed',
      'unchanged',
    ])
  })

  it('collapses only what needs no attention', () => {
    const open = Object.fromEntries(
      groupShots(diffs, new Set(['b-changed'])).map((g) => [g.kind, g.open]),
    )
    expect(open).toEqual({
      changed: true,
      added: true,
      removed: true,
      flaky: false,
      failed: true,
      unchanged: false,
    })
  })

  it('moves a changed screenshot that keeps changing on the default branch into Flaky', () => {
    const groups = groupShots(diffs, new Set(['b-changed', 'c-added']))
    expect(groups.find((g) => g.kind === 'flaky')?.items.map((d) => d.name)).toEqual(['b-changed'])
    // Only a changed screenshot can be flaky.
    expect(groups.find((g) => g.kind === 'added')?.items.map((d) => d.name)).toEqual(['c-added'])
    expect(groups.find((g) => g.kind === 'changed')?.items.map((d) => d.name)).toEqual([
      'f-changed',
    ])
  })

  it('leaves out a screenshot that has no status yet', () => {
    expect(orderShots(groupShots(diffs)).map((d) => d.name)).not.toContain('g-pending')
    expect(shotKind(diff('x', null), new Set())).toBeUndefined()
  })
})

describe('selection', () => {
  const ordered = orderShots(groupShots(diffs))

  it('walks in list order and stops at the ends', () => {
    expect(ordered.map((d) => d.name)).toEqual([
      'b-changed',
      'f-changed',
      'c-added',
      'd-removed',
      'e-failed',
      'a-unchanged',
    ])
    const [first, second] = ordered
    expect(neighbour(ordered, first, 1)).toBe(second)
    expect(neighbour(ordered, first, -1)).toBe(first)
    expect(neighbour(ordered, ordered.at(-1), 1)).toBe(ordered.at(-1))
    expect(neighbour([], undefined, 1)).toBeUndefined()
  })

  it('starts on the first screenshot that needs attention', () => {
    expect(defaultShot(groupShots(diffs))?.name).toBe('b-changed')
    expect(defaultShot(groupShots([diff('y', 'unchanged'), diff('z', 'unchanged')]))?.name).toBe(
      'y',
    )
    expect(defaultShot([])).toBeUndefined()
  })

  it('does not start on a flaky screenshot while another needs attention', () => {
    const groups = groupShots([diff('flake', 'changed'), diff('real', 'added')], new Set(['flake']))
    expect(defaultShot(groups)?.name).toBe('real')
  })
})

describe('diff percentages', () => {
  it.each([
    [0, '<0.01'],
    [0.00004, '<0.01'],
    [0.0042, '0.42'],
    [0.0099, '0.99'],
    [0.01, '1.0'],
    [0.125, '12.5'],
    [1, '100.0'],
  ])('%d of the pixels is "%s"', (score, text) => {
    expect(formatPercent(score)).toBe(text)
  })

  it('shows a percentage for a changed screenshot, "resized" for a size change, nothing otherwise', () => {
    expect(shotBadge({ status: 'changed', score: 0.0042, sizeChanged: false })).toBe('0.42%')
    expect(shotBadge({ status: 'changed', score: null, sizeChanged: true })).toBe('resized')
    expect(shotBadge({ status: 'changed', score: null, sizeChanged: false })).toBe('')
    expect(shotBadge({ status: 'added', score: 0.5, sizeChanged: false })).toBe('')
  })

  it('has a sentence form for the viewer', () => {
    expect(changeSummary({ score: 0.0042, sizeChanged: false })).toBe('0.42% of pixels changed')
    expect(changeSummary({ score: 0.5, sizeChanged: true })).toBe('Size changed')
    expect(changeSummary({ score: null, sizeChanged: false })).toBe('')
  })
})

describe('isReviewable', () => {
  it('is true only for a finished build with changes', () => {
    expect(isReviewable({ status: 'complete', conclusion: 'changes_detected' })).toBe(true)
    expect(isReviewable({ status: 'complete', conclusion: 'no_changes' })).toBe(false)
    expect(isReviewable({ status: 'processing', conclusion: null })).toBe(false)
  })
})

const decided = (decision: 'approved' | 'rejected') => ({
  decision,
  reviewer: null,
  at: '2026-01-01T00:00:00Z',
  reason: null,
})

describe('per-snapshot review', () => {
  const reviewed = [
    diff('a', 'changed', { review: decided('approved') }),
    diff('b', 'added'),
    diff('c', 'changed', { review: decided('rejected') }),
    diff('d', 'unchanged'),
  ]

  it('needs a decision for everything but unchanged and not yet compared snapshots', () => {
    expect(reviewed.map(needsDecision)).toEqual([true, true, true, false])
    expect(needsDecision(diff('x', null))).toBe(false)
  })

  it('counts the decided ones, and lists the undecided', () => {
    expect(reviewProgress(reviewed, 'pending')).toEqual({ reviewed: 2, total: 3 })
    expect(undecidedNames(reviewed, 'pending')).toEqual(['b'])
  })

  it('treats snapshots of an approved build as decided', () => {
    expect(reviewProgress([diff('a', 'changed')], 'approved')).toEqual({ reviewed: 1, total: 1 })
    expect(undecidedNames([diff('a', 'changed')], 'approved')).toEqual([])
  })
})

describe('reviewTargetStatus', () => {
  const now = Date.parse('2026-11-10T12:00:00.000Z')
  const at = (ms: number) => new Date(now + ms).toISOString()
  const status = (ms: number) => reviewTargetStatus({ hours: 24, dueAt: at(ms) }, now)

  it('counts down in the unit that fits', () => {
    expect(status(22 * 3_600_000 + 1)).toEqual({
      overdue: false,
      short: '22h left',
      long: '22h left of 24h',
    })
    expect(status(45 * 60_000)?.short).toBe('45m left')
    expect(status(30_000)?.short).toBe('1m left')
    expect(status(72 * 3_600_000)?.short).toBe('3d left')
  })

  it('is overdue strictly after the due time', () => {
    expect(reviewTargetStatus({ hours: 24, dueAt: at(0) }, now)?.overdue).toBe(false)
    expect(reviewTargetStatus({ hours: 24, dueAt: at(-2 * 3_600_000) }, now)).toEqual({
      overdue: true,
      short: 'Overdue 2h',
      long: 'Overdue 2h, past the 24h target',
    })
  })

  it('has nothing to say without a due time', () => {
    expect(reviewTargetStatus({ hours: 24, dueAt: null }, now)).toBeNull()
  })
})
