import { describe, expect, it } from 'vitest'

import {
  delta,
  formatBytes,
  formatHours,
  formatWait,
  rangeBounds,
  rejectionsLabel,
  targetHitRate,
  tiles,
  validateInsightsSearch,
} from '#features/insights/api.ts'
import {
  axisFor,
  backlogLine,
  bucketLabel,
  bucketName,
  decisionLines,
  failedBars,
  failedDelta,
  flakyDelta,
  flakyLine,
  flakySummary,
  isoWeek,
  labelIndexes,
  linePath,
  niceScale,
  outcomeSentence,
  outcomeStacks,
  reviewBars,
  storageBars,
  stripCells,
  stripLabel,
  tickLabel,
} from '#features/insights/chart.ts'

import { emptyWeek, fullReport, summary, week } from './fixtures.ts'

describe('insights search', () => {
  it('defaults to 30 days and drops junk', () => {
    expect(validateInsightsSearch({})).toEqual({ range: 30 })
    expect(validateInsightsSearch({ range: '7', team: 'web' })).toEqual({
      range: 7,
      team: 'web',
    })
    expect(validateInsightsSearch({ range: 90 })).toEqual({ range: 90 })
    expect(validateInsightsSearch({ range: '12', team: 3 })).toEqual({ range: 30 })
  })

  it('bounds the range at the end of the current hour, so what just happened is counted', () => {
    const now = Date.parse('2026-11-08T10:42:00Z')
    expect(rangeBounds(7, now)).toEqual({
      from: '2026-11-01T11:00:00.000Z',
      to: '2026-11-08T11:00:00.000Z',
    })
    expect(Date.parse(rangeBounds(30, now).to)).toBeGreaterThan(now)
  })
})

describe('formatting', () => {
  it('formats hours', () => {
    expect(formatHours(null)).toBe('–')
    expect(formatHours(0.5)).toBe('30m')
    expect(formatHours(3.44)).toBe('3.4h')
    expect(formatHours(12.4)).toBe('12h')
    expect(formatHours(72)).toBe('3.0d')
  })

  it('formats bytes', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(1536)).toBe('1.5 KB')
    expect(formatBytes(41.2 * 1024 ** 3)).toBe('41 GB')
  })

  it('says how long a build has waited, and counts rejections in the singular for one', () => {
    const h = 3_600_000
    expect(formatWait(9 * h)).toBe('9h')
    expect(formatWait(30 * 60_000)).toBe('30m')
    expect(formatWait(54 * h)).toBe('2d 6h')
    expect(formatWait(48 * h)).toBe('2d')
    expect(rejectionsLabel(1)).toBe('1 rejection')
    expect(rejectionsLabel(5)).toBe('5 rejections')
  })
})

describe('delta', () => {
  it('says whether a move is better', () => {
    expect(delta(3, 6, { better: 'lower' })).toMatchObject({
      text: '▼ 50%',
      tone: 'good',
      label: 'Down 50%, better',
    })
    expect(delta(9, 6, { better: 'lower' })).toMatchObject({ direction: 'up', tone: 'bad' })
    expect(delta(9, 6, { better: 'none' }).tone).toBe('neutral')
  })

  it('writes durations with hours and a percentage, counts plain, rates in points', () => {
    expect(delta(3.4, 6.1, { better: 'lower', unit: 'hours' })).toMatchObject({
      text: '▼ 2.7h · 44%',
      label: 'Down 2.7 hours, better',
    })
    expect(delta(31, 22, { better: 'lower', unit: 'count' })).toMatchObject({
      text: '▲ 9',
      label: 'Up 9, worse',
    })
    expect(delta(0.97, 0.95, { better: 'higher', unit: 'points' })).toMatchObject({
      text: '▲ 2 points',
      tone: 'good',
    })
  })

  it('handles nothing before, and no change', () => {
    expect(delta(2, 0, { better: 'higher' }).text).toBe('▲ new')
    expect(delta(null, 1, { better: 'lower' }).direction).toBe('flat')
    expect(delta(4, 4, { better: 'lower' })).toMatchObject({
      text: '● same as before',
      label: 'Unchanged',
    })
  })
})

describe('axes', () => {
  it('rounds the top up to a multiple and picks whole-number gridlines', () => {
    expect(axisFor(5.2, { multiple: 3 })).toEqual({ top: 6, ticks: [2, 4, 6] })
    expect(axisFor(0, { multiple: 3 })).toEqual({ top: 3, ticks: [1, 2, 3] })
    expect(axisFor(22, { multiple: 10 })).toEqual({ top: 30, ticks: [10, 20, 30] })
    expect(axisFor(101, { multiple: 40 }).top).toBe(120)
    expect(axisFor(3, { multiple: 2 })).toEqual({ top: 4, ticks: [1, 2, 3, 4] })
    expect(axisFor(13, { multiple: 5, tickStep: 5 })).toEqual({ top: 15, ticks: [5, 10, 15] })
  })

  it('picks round axis tops', () => {
    expect(niceScale(5.2)).toEqual({ top: 6, ticks: [2, 4, 6] })
    expect(niceScale(12).top).toBe(15)
    expect(niceScale(0).ticks).toHaveLength(3)
    expect(tickLabel(0.30000000000000004)).toBe('0.3')
  })

  it('thins labels, keeping the last', () => {
    expect([...labelIndexes(13, 7)].toSorted((a, b) => a - b)).toEqual([0, 2, 4, 6, 8, 10, 12])
    expect(labelIndexes(3).size).toBe(3)
  })

  it('names buckets: weeks by date or number, days by weekday', () => {
    expect(bucketLabel('2026-11-02T00:00:00Z', 'week')).toBe('Nov 2')
    expect(bucketName('2026-10-26T00:00:00Z', 'week')).toBe('W44')
    expect(bucketLabel('2026-11-09T00:00:00Z', 'day')).toBe('Mon 9')
    expect(bucketName('2026-11-09T00:00:00Z', 'day')).toBe('Mon 9')
    expect(isoWeek('2025-12-29T00:00:00.000Z')).toBe(1)
  })
})

describe('chart data', () => {
  it('scales review bars in percent of the axis, bare for a week with no reviews', () => {
    const { top, bars, goalPct } = reviewBars(
      [week('2026-11-02T00:00:00Z', { medianReviewHours: 6 }), emptyWeek('2026-11-09T00:00:00Z')],
      3,
    )
    expect(top).toBe(6)
    expect(bars.map((b) => b.height)).toEqual([100, 0])
    expect(goalPct).toBe(50)
    expect(bars[0]?.label).toBe('Nov 2')
  })

  it('draws medians under an hour in minutes', () => {
    const { unit, ticks } = reviewBars([
      week('2026-11-02T00:00:00Z', { medianReviewHours: 0.0005 }),
    ])
    expect(unit).toBe('minutes')
    expect(ticks).toEqual([1, 2, 3])
    expect(reviewBars([week('2026-11-02T00:00:00Z')]).unit).toBe('hours')
  })

  it('stacks outcomes bottom to top and leaves empty segments out', () => {
    const { top, bars, empty } = outcomeStacks([
      week('2026-11-02T00:00:00Z', {
        outcomes: { approved: 44, autoApproved: 59, rejected: 0, failed: 4 },
      }),
    ])
    expect(top).toBe(120)
    expect(bars[0]?.segments.map((s) => s.key)).toEqual(['approved', 'autoApproved', 'failed'])
    expect(outcomeSentence(bars[0]!)).toBe('44 approved, 59 auto-approved, 0 rejected, 4 failed')
    expect(empty).toBe(false)
    expect(outcomeStacks([emptyWeek('2026-11-02T00:00:00Z')]).empty).toBe(true)
  })

  it('puts the decision axis at the next 10 above the 90th percentile, and breaks lines at gaps', () => {
    const weeks = [
      week('2026-11-02T00:00:00Z', { p90DecisionHours: 22, medianDecisionHours: 8 }),
      emptyWeek('2026-11-09T00:00:00Z'),
      week('2026-11-16T00:00:00Z', { p90DecisionHours: 12, medianDecisionHours: 6 }),
    ]
    const { top, median } = decisionLines(weeks)
    expect(top).toBe(30)
    expect(median.map((d) => d.y)).toEqual([expect.closeTo(26.67, 1), null, 20])
    expect(linePath(median).match(/M/g)).toHaveLength(2)
    expect(linePath(median, true)).toContain('Z')
  })

  it('counts failed builds per bucket on a whole-number axis, and the delta against before', () => {
    const { top, bars } = failedBars([week('2026-11-02T00:00:00Z', { failedBuilds: 5 })])
    expect(top).toBe(6)
    expect(bars[0]?.height).toBeCloseTo(83.3, 0)
    expect(failedDelta(31, 22)).toMatchObject({ text: '▲ 9 vs before', tone: 'bad' })
    expect(failedDelta(19, 22)).toMatchObject({ text: '▼ 3 vs before', tone: 'good' })
    expect(failedDelta(2, 2)).toMatchObject({ text: '● same as before', tone: 'neutral' })
  })

  it('draws the backlog on an axis every 5, and is empty when nothing waited', () => {
    const line = backlogLine([
      { day: '2026-11-06T00:00:00Z', waiting: 3 },
      { day: '2026-11-07T00:00:00Z', waiting: 6 },
    ])
    expect(line.ticks).toEqual([5, 10])
    expect(line.empty).toBe(false)
    expect(backlogLine([{ day: '2026-11-06T00:00:00Z', waiting: 0 }]).empty).toBe(true)
  })

  it('draws the flaky line with ticks every 10', () => {
    expect(flakyLine([week('2026-11-02T00:00:00Z', { flaky: 12 })]).ticks).toEqual([10, 20])
    expect(
      flakySummary([week('2026-11-02T00:00:00Z', { flaky: 12 }), week('2026-11-09T00:00:00Z')]),
    ).toContain('fell from 12 to 7')
  })

  it('pads the strip of the last builds, oldest left, and words it for a screen reader', () => {
    expect(stripCells([true, false])).toEqual([
      ...Array.from({ length: 8 }, () => null),
      true,
      false,
    ])
    expect(stripLabel([true, false, true])).toBe('Changed in 2 of the last 3 commits')
    expect(stripLabel(Array.from({ length: 10 }, (_, i) => i < 6))).toBe(
      'Changed in 6 of the last 10 commits',
    )
  })

  it('sorts storage by size, with team colours', () => {
    const bars = storageBars(fullReport().storage)
    expect(bars.map((b) => [b.slug, b.colour, b.share])).toEqual([
      ['web', 'slate', 1],
      ['docs', 'moss', 0.5],
    ])
  })
})

describe('summary tiles', () => {
  it('writes the six tiles in order', () => {
    const t = tiles(fullReport(), 90)
    expect(t.map((x) => x.title)).toEqual([
      'Median time to first review',
      'Median time to decision',
      'First reviews within target',
      'Builds reviewed',
      'Builds with changes',
      'Failed builds',
    ])
    expect(t[0]).toMatchObject({
      value: '3.4h',
      note: '90th percentile 11h, vs the 90 days before',
      delta: { text: '▼ 2.7h · 44%' },
    })
    expect(t[1]).toMatchObject({
      value: '7.8h',
      note: '90th percentile 22h, build ready to approved or rejected',
    })
    expect(t[2]).toMatchObject({
      value: '98%',
      note: '182 of 186 reviews, weekends not counted',
    })
    expect(t[4]?.note).toBe('92 of 400 finished builds')
    expect(t[5]).toMatchObject({
      value: '31',
      delta: { text: '▲ 9', tone: 'bad' },
      note: '7.2% of finished builds',
    })
  })

  it('has no dangling comparison, and dashes instead of 0m with nothing reviewed', () => {
    const first = tiles(fullReport({ previous: summary({ medianReviewHours: null }) }), 30)[0]
    expect(first?.note).toBe('90th percentile 11h')
    expect(first?.delta.text).toBe('● no comparison')
    const none = tiles(
      fullReport({ summary: summary({ buildsReviewed: 0, medianReviewHours: 0 }) }),
      7,
    )[0]
    expect(none).toMatchObject({ value: '–', note: 'No reviews in the last 7 days' })
  })

  it('shows the hit rate only when some team has a target', () => {
    const noTarget = fullReport({
      reviewTargetHours: null,
      summary: summary({ reviewedWithTarget: 0, reviewedOverTarget: 0 }),
    })
    expect(targetHitRate(noTarget.summary)).toBeNull()
    expect(tiles(noTarget, 30)[2]).toMatchObject({ value: '–', note: 'No review target set' })
  })

  it('says no decisions instead of a median when none were decided', () => {
    const t = tiles(fullReport({ summary: summary({ buildsDecided: 0 }) }), 30)[1]
    expect(t).toMatchObject({ value: '–', note: 'No builds were decided in the last 30 days' })
  })
})

const w = (start: string, flaky: number) => week(start, { flaky })

describe('the flaky delta', () => {
  it('says how many fewer or more since the first week, grey when equal', () => {
    expect(
      flakyDelta([w('2026-10-26T00:00:00.000Z', 12), w('2026-11-02T00:00:00.000Z', 7)]),
    ).toMatchObject({ text: '▼ 5 since W44', tone: 'good' })
    expect(
      flakyDelta([w('2026-10-26T00:00:00.000Z', 2), w('2026-11-02T00:00:00.000Z', 3)]),
    ).toMatchObject({ text: '▲ 1 since W44', tone: 'bad' })
    expect(
      flakyDelta([w('2026-10-26T00:00:00.000Z', 4), w('2026-11-02T00:00:00.000Z', 4)]),
    ).toMatchObject({ tone: 'neutral' })
    expect(flakyDelta([w('2026-10-26T00:00:00.000Z', 4)])).toBeNull()
  })
})
