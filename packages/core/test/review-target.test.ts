import { describe, expect, it } from 'vitest'

import { isOverdue, isSnoozed, overdueBy, reviewDueAt } from '#src/index.ts'

const due = new Date('2026-01-02T12:00:00.000Z')
const at = (ms: number) => new Date(due.getTime() + ms)

describe('reviewDueAt', () => {
  it('adds the target in hours', () => {
    const from = new Date('2026-01-01T12:00:00.000Z')
    expect(reviewDueAt(from, 24)).toEqual(due)
    expect(reviewDueAt(from, 1)).toEqual(new Date('2026-01-01T13:00:00.000Z'))
  })

  it('is null when the team has no review target', () => {
    expect(reviewDueAt(new Date(), null)).toBeNull()
  })
})

describe('isOverdue and overdueBy', () => {
  it('is on time 1ms before the due time', () => {
    expect(isOverdue(due, at(-1))).toBe(false)
    expect(overdueBy(due, at(-1))).toBe(0)
  })

  it('is on time exactly at the due time', () => {
    expect(isOverdue(due, due)).toBe(false)
    expect(overdueBy(due, due)).toBe(0)
  })

  it('is overdue 1ms after the due time', () => {
    expect(isOverdue(due, at(1))).toBe(true)
    expect(overdueBy(due, at(1))).toBe(1)
  })

  it('counts how long it has been overdue', () => {
    expect(overdueBy(due, at(3 * 3_600_000))).toBe(3 * 3_600_000)
  })

  it('is never overdue without a due time (no review target)', () => {
    expect(isOverdue(null, at(1_000_000_000))).toBe(false)
    expect(overdueBy(null, at(1_000_000_000))).toBe(0)
  })

  it('is not overdue while snoozed', () => {
    expect(isOverdue(due, at(1), true)).toBe(false)
    expect(overdueBy(due, at(1), true)).toBe(0)
  })
})

describe('isSnoozed', () => {
  const until = new Date('2026-01-03T00:00:00.000Z')

  it('is not snoozed without a kind', () => {
    expect(isSnoozed({ snoozedUntil: null, snoozeKind: null }, until)).toBe(false)
  })

  it('lasts until the end time, which is no longer snoozed', () => {
    const snooze = { snoozedUntil: until, snoozeKind: 'tomorrow' }
    expect(isSnoozed(snooze, new Date(until.getTime() - 1))).toBe(true)
    expect(isSnoozed(snooze, until)).toBe(false)
  })

  it('lasts until the next push when there is no end time', () => {
    expect(isSnoozed({ snoozedUntil: null, snoozeKind: 'next_push' }, until)).toBe(true)
  })
})
