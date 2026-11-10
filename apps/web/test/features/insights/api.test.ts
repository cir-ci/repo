import { describe, expect, it } from 'vitest'

import {
  delta,
  formatBytes,
  formatHours,
  rangeBounds,
  tiles,
  validateInsightsSearch,
} from '#features/insights/api.ts'
import {
  flakyDelta,
  isoWeek,
  flakySummary,
  labelIndexes,
  niceScale,
  reviewBars,
  storageBars,
  tickLabel,
} from '#features/insights/chart.ts'

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

  it('handles points, nothing before, and no change', () => {
    expect(delta(0.23, 0.2, { better: 'none', unit: 'points' }).text).toBe('▲ 3 pts')
    expect(delta(2, 0, { better: 'higher' }).text).toBe('▲ new')
    expect(delta(null, 1, { better: 'lower' }).direction).toBe('flat')
    expect(delta(4, 4, { better: 'lower' }).label).toBe('Unchanged')
  })
})

const week = (weekStart: string, medianReviewHours: number | null, flaky = 0) => ({
  weekStart,
  medianReviewHours,
  reviews: 1,
  flaky,
})

describe('chart data', () => {
  it('picks round axis tops', () => {
    expect(niceScale(5.2)).toEqual({ top: 6, ticks: [2, 4, 6] })
    expect(niceScale(12).top).toBe(15)
    expect(niceScale(0).ticks).toHaveLength(3)
  })

  it('scales bars and leaves empty weeks bare', () => {
    const { top, bars } = reviewBars([
      week('2026-11-02T00:00:00Z', 6),
      week('2026-11-09T00:00:00Z', null),
    ])
    expect(top).toBe(6)
    expect(bars[0]?.height).toBeGreaterThan(0)
    expect(bars[1]?.height).toBe(0)
    expect(bars[0]?.label).toBe('Nov 2')
  })

  it('draws medians under an hour in minutes, with ticks that fit the axis', () => {
    const { unit, ticks } = reviewBars([week('2026-11-02T00:00:00Z', 0.0005)])
    expect(unit).toBe('minutes')
    expect(ticks.map(tickLabel)).toEqual(['1', '2', '3'])
    expect(tickLabel(0.30000000000000004)).toBe('0.3')
    expect(reviewBars([week('2026-11-02T00:00:00Z', 3)]).unit).toBe('hours')
  })

  it('thins labels, keeping the last', () => {
    expect([...labelIndexes(13, 7)].toSorted((a, b) => a - b)).toEqual([0, 2, 4, 6, 8, 10, 12])
    expect(labelIndexes(3).size).toBe(3)
  })

  it('summarises and sorts', () => {
    expect(
      flakySummary([week('2026-11-02T00:00:00Z', 1, 12), week('2026-11-09T00:00:00Z', 1, 7)]),
    ).toContain('fell from 12 to 7')
    const bars = storageBars({
      totalBytes: 3,
      teams: [
        { slug: 'a', name: 'A', bytes: 1 },
        { slug: 'b', name: 'B', bytes: 2 },
      ],
    })
    expect(bars.map((b) => [b.slug, b.share])).toEqual([
      ['b', 1],
      ['a', 0.5],
    ])
  })
})

const report = (over: { reviewed: number; median: number | null; before: number | null }) =>
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- only the fields the tiles read
  ({
    summary: {
      medianReviewHours: over.median,
      p90ReviewHours: over.median,
      buildsReviewed: over.reviewed,
      buildsWithChanges: 0,
      buildsFinished: 0,
      changeRate: null,
      reviewedOverTarget: 0,
    },
    previous: {
      medianReviewHours: over.before,
      p90ReviewHours: over.before,
      buildsReviewed: 0,
      changeRate: null,
      reviewedOverTarget: 0,
    },
  }) as unknown as Parameters<typeof tiles>[0]

describe('summary tiles', () => {
  it('writes whole sentences, with no dangling comparison', () => {
    const [withBefore] = tiles(report({ reviewed: 4, median: 2, before: 4 }), 30)
    expect(withBefore?.note).toBe('90th percentile 2.0h, vs the 30 days before')
    const [firstPeriod] = tiles(report({ reviewed: 4, median: 2, before: null }), 30)
    expect(firstPeriod?.note).toBe('90th percentile 2.0h')
    expect(firstPeriod?.delta.text).toBe('● no comparison')
  })

  it('shows no median, instead of 0m, when nothing was reviewed', () => {
    const [none] = tiles(report({ reviewed: 0, median: 0, before: null }), 7)
    expect(none?.value).toBe('–')
    expect(none?.note).toBe('No reviews in the last 7 days')
  })
})

const flakyWeek = (weekStart: string, flaky: number) => ({
  weekStart,
  medianReviewHours: null,
  reviews: 0,
  flaky,
})

describe('the flaky delta', () => {
  it('numbers weeks the ISO way', () => {
    expect(isoWeek('2026-10-26T00:00:00.000Z')).toBe(44)
    expect(isoWeek('2026-01-05T00:00:00.000Z')).toBe(2)
    expect(isoWeek('2025-12-29T00:00:00.000Z')).toBe(1)
  })

  it('says how many fewer or more since the first week', () => {
    const fewer = flakyDelta([
      flakyWeek('2026-10-26T00:00:00.000Z', 12),
      flakyWeek('2026-11-02T00:00:00.000Z', 7),
    ])
    expect(fewer).toMatchObject({ text: '▼ 5 since W44', tone: 'good' })
    const more = flakyDelta([
      flakyWeek('2026-10-26T00:00:00.000Z', 2),
      flakyWeek('2026-11-02T00:00:00.000Z', 3),
    ])
    expect(more).toMatchObject({ text: '▲ 1 since W44', tone: 'bad' })
  })

  it('says nothing when nothing moved or there is one week', () => {
    expect(
      flakyDelta([
        flakyWeek('2026-10-26T00:00:00.000Z', 4),
        flakyWeek('2026-11-02T00:00:00.000Z', 4),
      ]),
    ).toBeNull()
    expect(flakyDelta([flakyWeek('2026-10-26T00:00:00.000Z', 4)])).toBeNull()
  })
})
