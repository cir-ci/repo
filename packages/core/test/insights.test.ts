import { describe, expect, it } from 'vitest'

import {
  bucketsBetween,
  failureGroup,
  median,
  percentile,
  tallyFailures,
  weekStart,
  weeksBetween,
} from '#src/index.ts'

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

describe('bucketsBetween', () => {
  it('is the weeks for week buckets and the UTC days for day buckets', () => {
    const from = new Date('2026-11-01T11:00:00Z')
    const to = new Date('2026-11-08T11:00:00Z')
    expect(bucketsBetween(from, to, 'week')).toEqual(weeksBetween(from, to))
    const days = bucketsBetween(from, to, 'day')
    expect(days).toHaveLength(8)
    expect(days[0]?.toISOString()).toBe('2026-11-01T00:00:00.000Z')
    expect(days.at(-1)?.toISOString()).toBe('2026-11-08T00:00:00.000Z')
  })
})

describe('failure groups', () => {
  it('gives the known producers one label each, whatever the numbers in the text', () => {
    expect(
      failureGroup('Timed out waiting for 2 of 4 shard(s): shard 3, 4. The CI job(s) failed.')
        .label,
    ).toBe('Timed out waiting for shards')
    expect(failureGroup('Timed out waiting for 1 of 2 shard(s). The CI job(s)...').key).toBe(
      'timed-out-shards',
    )
    expect(failureGroup('The upload never finished: the CI job stopped.').key).toBe(
      'upload-never-finished',
    )
    expect(failureGroup('Expected a PNG, got jpeg').label).toBe(
      "A screenshot file isn't a valid image",
    )
    expect(failureGroup(null).label).toBe('No message was recorded')
  })

  it('groups anything else by its first sentence with the numbers replaced', () => {
    expect(failureGroup('Diff job 12 failed. Retries exhausted').label).toBe('Diff job # failed')
    expect(failureGroup('diff job 7 failed').key).toBe('diff job # failed')
  })

  it('tallies most common first', () => {
    expect(
      tallyFailures(['Boom', 'Timed out waiting for 1 of 2 shard(s).', 'boom', 'Boom.', null], 2),
    ).toEqual([
      { message: 'Boom', builds: 3 },
      { message: 'No message was recorded', builds: 1 },
    ])
  })
})
