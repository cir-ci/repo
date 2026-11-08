import { describe, expect, it } from 'vitest'

import {
  delta,
  formatBytes,
  formatHours,
  rangeBounds,
  validateInsightsSearch,
} from '#features/insights/api.ts'
import {
  flakySummary,
  labelIndexes,
  niceScale,
  reviewBars,
  storageBars,
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

  it('bounds the range at the current hour', () => {
    const now = Date.parse('2026-11-08T10:42:00Z')
    expect(rangeBounds(7, now)).toEqual({
      from: '2026-11-01T10:00:00.000Z',
      to: '2026-11-08T10:00:00.000Z',
    })
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
