import { describe, expect, it } from 'vitest'

import { median, percentile, weekStart, weeksBetween } from '#src/index.ts'

describe('percentile', () => {
  it('interpolates like percentile_cont', () => {
    expect(median([4, 1, 3, 2])).toBe(2.5)
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.9)).toBeCloseTo(9.1)
    expect(median([7])).toBe(7)
  })
  it('is null without values', () => {
    expect(median([])).toBeNull()
  })
})

describe('weeks', () => {
  it('start on Monday, midnight UTC', () => {
    // 2026-03-11 is a Wednesday.
    expect(weekStart(new Date('2026-03-11T15:00:00Z')).toISOString()).toBe(
      '2026-03-09T00:00:00.000Z',
    )
    expect(weekStart(new Date('2026-03-15T23:59:00Z')).toISOString()).toBe(
      '2026-03-09T00:00:00.000Z',
    )
    expect(weekStart(new Date('2026-03-09T00:00:00Z')).toISOString()).toBe(
      '2026-03-09T00:00:00.000Z',
    )
  })
  it('lists every week the range touches', () => {
    const weeks = weeksBetween(new Date('2026-03-11T00:00:00Z'), new Date('2026-03-23T00:00:00Z'))
    expect(weeks.map((w) => w.toISOString().slice(0, 10))).toEqual(['2026-03-09', '2026-03-16'])
    // The end is exclusive: a range ending at midnight Monday doesn't touch that week.
    expect(
      weeksBetween(new Date('2026-03-09T00:00:00Z'), new Date('2026-03-16T00:00:00Z')),
    ).toHaveLength(1)
  })
})
