import type { Build } from '@circi/api'
import { describe, expect, it } from 'vitest'

import {
  baselineHow,
  changeSummary,
  defaultShot,
  formatPercent,
  groupShots,
  isReviewable,
  needsDecision,
  neighbour,
  nextToReview,
  decisionText,
  groupDecisions,
  openReviewRequests,
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
  it("orders groups Couldn't read, Changed, Added, Removed, Flaky, Unchanged and drops empty ones", () => {
    expect(groupShots(diffs).map((g) => g.kind)).toEqual([
      'failed',
      'changed',
      'added',
      'removed',
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

  it('opens Flaky when it holds the only changes', () => {
    const only = [diff('a', 'unchanged'), diff('b', 'changed')]
    const groups = groupShots(only, new Set(['b']))
    expect(groups.map((g) => [g.kind, g.open])).toEqual([
      ['flaky', true],
      ['unchanged', false],
    ])
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
      'e-failed',
      'b-changed',
      'f-changed',
      'c-added',
      'd-removed',
      'a-unchanged',
    ])
    const [first, second] = ordered
    expect(neighbour(ordered, first, 1)).toBe(second)
    expect(neighbour(ordered, first, -1)).toBe(first)
    expect(neighbour(ordered, ordered.at(-1), 1)).toBe(ordered.at(-1))
    expect(neighbour([], undefined, 1)).toBeUndefined()
  })

  it('moves on after an approval to the next screenshot that still needs a decision', () => {
    const a = diff('a', 'changed')
    const b = diff('b', 'changed', {
      review: { decision: 'approved', reviewer: null, at: '2026-01-01T00:00:00Z', reason: null },
    })
    const d = diff('d', 'added')
    const list = [a, b, diff('c', 'unchanged'), d]
    // b is decided and c needs none: d is next; from d it wraps to a.
    expect(nextToReview(list, a, 'pending')).toBe(d)
    expect(nextToReview(list, d, 'pending')).toBe(a)
    // Nothing else left: undefined.
    expect(nextToReview([a], a, 'pending')).toBeUndefined()
    expect(nextToReview(list, a, 'approved')).toBeUndefined()
  })

  it('starts on the first screenshot that needs attention', () => {
    expect(defaultShot(groupShots(diffs))?.name).toBe('b-changed')
    expect(defaultShot(groupShots([diff('y', 'unchanged'), diff('z', 'unchanged')]))?.name).toBe(
      'y',
    )
    expect(defaultShot([])).toBeUndefined()
  })

  it("starts on a screenshot that couldn't be read only when nothing needs a decision", () => {
    expect(defaultShot(groupShots([diff('bad', 'failed'), diff('y', 'unchanged')]))?.name).toBe(
      'bad',
    )
    expect(defaultShot(groupShots([diff('bad', 'failed'), diff('real', 'added')]))?.name).toBe(
      'real',
    )
  })

  it("asks no decision of a screenshot that couldn't be read", () => {
    expect(needsDecision(diff('bad', 'failed'))).toBe(false)
    expect(undecidedNames([diff('bad', 'failed'), diff('a', 'changed')], 'pending')).toEqual(['a'])
    expect(reviewProgress([diff('bad', 'failed'), diff('a', 'changed')], 'pending')).toEqual({
      reviewed: 0,
      total: 1,
    })
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

const person = (who: string) => ({ id: who, name: who.toUpperCase(), image: null })

describe('openReviewRequests', () => {
  it('keeps who asked and when, drops closed requests, and has no asker for an automatic one', () => {
    const requests = openReviewRequests([
      { type: 'review_requested', at: 't1', reviewer: person('a'), by: person('x') },
      { type: 'review_requested', at: 't2', reviewer: person('b'), by: null },
      { type: 'review_requested', at: 't3', reviewer: person('c'), by: person('x') },
      { type: 'review_request_closed', at: 't4', reviewer: person('c'), state: 'done' },
    ])
    expect(requests.map((r) => [r.person.id, r.by?.id ?? null, r.at])).toEqual([
      ['a', 'x', 't1'],
      ['b', null, 't2'],
    ])
  })
})

describe('baselineHow', () => {
  it('says where an ancestry match started, and the fallback with its reason', () => {
    expect(baselineHow({ baselineSource: 'provider', ancestryStatus: 'ok' }, 'main')).toBe(
      'where this branch started',
    )
    expect(baselineHow({ baselineSource: 'fallback', ancestryStatus: 'missing' }, 'main')).toBe(
      "the latest on main: this build's git history wasn't available",
    )
    expect(baselineHow({ baselineSource: 'cli', ancestryStatus: 'truncated' }, 'main')).toBe(
      'where this branch started, as far as its git history reaches',
    )
  })
})

const approved = (name: string, at: string, by: string | null = 'Olivia Owner') => ({
  decision: 'approved' as const,
  by,
  automatic: by === null,
  reason: null,
  at,
  name,
})

describe('groupDecisions', () => {
  it('collapses identical decisions into one with a count, the newest time and the names', () => {
    const groups = groupDecisions([
      approved('a', '2026-01-01T10:00:00Z'),
      approved('b', '2026-01-01T12:00:00Z'),
      approved('c', '2026-01-01T11:00:00Z'),
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({
      count: 3,
      at: '2026-01-01T12:00:00Z',
      names: ['a', 'b', 'c'],
    })
  })

  it('keeps apart different reviewers, outcomes and reasons', () => {
    const groups = groupDecisions([
      approved('a', '2026-01-01T10:00:00Z'),
      approved('b', '2026-01-01T10:00:00Z', 'Maya Levi'),
      { ...approved('c', '2026-01-01T10:00:00Z'), decision: 'rejected', reason: 'Off by 2px' },
    ])
    expect(groups.map((g) => g.count)).toEqual([1, 1, 1])
  })

  it('words a decision without a count', () => {
    expect(decisionText({ decision: 'approved', by: 'Olivia Owner', automatic: false })).toBe(
      'Approved by Olivia Owner',
    )
    expect(decisionText({ decision: 'approved', by: null, automatic: true })).toBe(
      'Approved automatically',
    )
    expect(decisionText({ decision: 'rejected', by: null, automatic: false })).toBe('Rejected')
  })
})
